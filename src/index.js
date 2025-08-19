/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const later = require('@breejs/later');

// 辅助函数：解析cron表达式并计算下次执行时间
function parseCronAndGetNextRunTime(cronExpression) {
	const hasSeconds = cronExpression.split(' ').length === 7;
	const schedule = later.parse.cron(cronExpression, hasSeconds);
	const nextRunTime = later.schedule(schedule).next(1);
	
	if (!nextRunTime) {
		throw new Error("该cron未来没有触发执行的时间点");
	}
	
	const timestamp = nextRunTime.getTime();
	
	// 验证是否有未来的执行时间点
	if (timestamp === 0) {
		throw new Error("该cron未来没有触发执行的时间点");
	}
	
	return timestamp;
}

export default {
	async fetch(request, env, ctx) {
		let input = {};
		if (request.method === "POST") {
			input = await request.json();
		} else if (request.method === "GET") {
			const url = new URL(request.url);
			for (const [k, v] of url.searchParams.entries()) {
				input[k] = v;
			}
		} else {
			return new Response("Method Not Allowed", { status: 405 });
		}

		const { action, url, params, job_id, user_id, cron, method, headers, type, status } = input;
		console.log("input", input);
		if (!type) {
			return new Response("Missing type", { status: 400 });
		}
		const db = env.DB;

		try {
			if (action === "create") {
				if (!url || !params || !job_id || !user_id || !cron || !method) {
					return new Response(JSON.stringify({ code: 1, msg: "Missing parameters" }), { headers: { "Content-Type": "application/json" } });
				}

				// Convert params and header objects to strings for storage
				const paramsStr = typeof params === 'object' ? JSON.stringify(params) : params;
				const headerStr = typeof headers === 'object' ? JSON.stringify(headers) : (headers || '');

				// Calculate next_run_time
				let nextRunTime;
				try {
					nextRunTime = parseCronAndGetNextRunTime(cron);
				} catch (error) {
					return new Response(JSON.stringify({ code: 2, msg: error.message }), { headers: { "Content-Type": "application/json" } });
				}

				// Set default status to 'active' if not provided
				const jobStatus = status || 'active';

				await db.prepare(
					"INSERT INTO mcp_scheduler_jobs (url, params, job_id, user_id, cron, last_run_time, next_run_time, method, headers, type, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
				).bind(url, paramsStr, job_id, user_id, cron, null, nextRunTime, method, headerStr, type || '', jobStatus).run();
				return new Response(JSON.stringify({ code: 0, msg: "Creation successful" }), { headers: { "Content-Type": "application/json" } });
			}

			if (action === "delete") {
				if (!job_id) {
					return new Response(JSON.stringify({ code: 1, msg: "Missing job_id" }), { headers: { "Content-Type": "application/json" } });
				}
				await db.prepare("DELETE FROM mcp_scheduler_jobs WHERE job_id = ?").bind(job_id).run();
				return new Response(JSON.stringify({ code: 0, msg: "Deletion successful" }), { headers: { "Content-Type": "application/json" } });
			}

			if (action === "edit") {
				if (!job_id || !user_id) {
					return new Response(JSON.stringify({ code: 1, msg: "Missing job_id or user_id" }), { headers: { "Content-Type": "application/json" } });
				}

				// Check if job exists and belongs to the user
				const existingJob = await db.prepare("SELECT * FROM mcp_scheduler_jobs WHERE job_id = ? AND user_id = ?").bind(job_id, user_id).first();
				if (!existingJob) {
					return new Response(JSON.stringify({ code: 2, msg: "Job not found or access denied" }), { headers: { "Content-Type": "application/json" } });
				}

				// 处理状态更新
				const jobStatus = status !== undefined ? status : existingJob.status;

				// Convert params and header objects to strings for storage
				const paramsStr = typeof params === 'object' ? JSON.stringify(params) : (params || existingJob.params);
				const headerStr = typeof headers === 'object' ? JSON.stringify(headers) : (headers || existingJob.headers);

				// Calculate next_run_time if cron is changed
				let nextRunTime = existingJob.next_run_time;
				if (cron && cron !== existingJob.cron) {
					try {
						nextRunTime = parseCronAndGetNextRunTime(cron);
					} catch (error) {
						return new Response(JSON.stringify({ code: 2, msg: error.message }), { headers: { "Content-Type": "application/json" } });
					}
				}

				await db.prepare(
					"UPDATE mcp_scheduler_jobs SET url = ?, params = ?, cron = ?, method = ?, headers = ?, next_run_time = ?, status = ? WHERE job_id = ? AND user_id = ?"
				).bind(
					url || existingJob.url,
					paramsStr,
					cron || existingJob.cron,
					method || existingJob.method,
					headerStr,
					nextRunTime,
					jobStatus,
					job_id,
					user_id
				).run();

				return new Response(JSON.stringify({ code: 0, msg: "Update successful" }), { headers: { "Content-Type": "application/json" } });
			}

			if (action === "query") {
				let result;
				if (job_id) {
					result = await db.prepare("SELECT * FROM mcp_scheduler_jobs WHERE job_id = ?").bind(job_id).all();
				} else if (user_id) {
					result = await db.prepare("SELECT * FROM mcp_scheduler_jobs WHERE user_id = ?").bind(user_id).all();
				} else {
					result = await db.prepare("SELECT * FROM mcp_scheduler_jobs").all();
				}
				return new Response(JSON.stringify({ code: 0, msg: "Query successful", data: result.results }), { headers: { "Content-Type": "application/json" } });
			}

			return new Response(JSON.stringify({ code: 1, msg: "Unknown action" }), { headers: { "Content-Type": "application/json" } });
		} catch (err) {
			return new Response(JSON.stringify({ code: 500, msg: "Database operation failed: " + err.message }), { headers: { "Content-Type": "application/json" } });
		}
	},

	async scheduled(event, env, ctx) {
        const db = env.DB;
        const now = Date.now();

        // 1. Find all active jobs that need to be executed
        const result = await db.prepare(
            "SELECT * FROM mcp_scheduler_jobs WHERE next_run_time <= ? AND status = 'active' and next_run_time > 0"
        ).bind(now).all();

        const jobs = result.results || [];
        if (jobs.length === 0) {
            console.log('No active scheduled tasks to execute');
            return;
        }

        // 2. Asynchronously process each job
        await Promise.all(jobs.map(async (job) => {
            try {
                // Call the fixed trigger entry API
                const response = await fetch("https://gateway-dev.xcelsior.ai/api/v1/event/schedule/action", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "run-task-token": "123e4567-e89b-12d3-a456-426614174000"
                    },
                    body: JSON.stringify(job) // Pass the entire job object as a parameter
                });

                const responseText = await response.text();
                console.log(`Task ${job.job_id} trigger response:`, responseText);

                // 2.2 Calculate the next run time
                let nextRunTime;
                try {
                    nextRunTime = parseCronAndGetNextRunTime(job.cron);
                } catch (error) {
                    console.error(`Task ${job.job_id} cron parsing failed:`, error.message);
                    nextRunTime = 0;
                }
                const lastRunTime = Date.now();

                // 2.3 Update the database
                await db.prepare(
                    "UPDATE mcp_scheduler_jobs SET last_run_time = ?, next_run_time = ? WHERE job_id = ?"
                ).bind(lastRunTime, nextRunTime, job.job_id).run();

                console.log(`Task ${job.job_id} executed and updated successfully`);
            } catch (err) {
                console.error(`Task ${job.job_id} execution failed:`, err);
            }
        }));
    }
};
