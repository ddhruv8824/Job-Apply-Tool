# Daily scheduled discovery

`npm run daily` runs one discovery-and-matching cycle and exits. Scheduled mode never submits applications, regardless of `APPLY_DRY_RUN` or `BATCH_DRY_RUN`. Review prepared candidates later with `npm run apply:batch`.

## Prerequisites

1. Configure `DATABASE_URL` and apply the Prisma migrations.
2. Keep PostgreSQL running.
3. Start the manually managed Chrome profile with CDP port 9222.
4. Log into Naukri manually in that Chrome profile.
5. Verify one cycle from a terminal with `npm run daily`.

The command exits non-zero before browser or AI work if PostgreSQL is unavailable. It also refuses overlapping recent daily runs and marks stale daily runs failed before proceeding.

## Windows Task Scheduler

Create a task manually in Windows Task Scheduler and configure its action as:

- Program/script: `scripts\\run-daily-agent.cmd`
- Start in: the project directory

Use an absolute path in the Task Scheduler action itself because Windows scheduled tasks may start from another working directory. The helper script derives the project directory from its own location and contains no user-specific path.

Do not configure the task to run `apply:batch`. Applications remain an explicit interactive action.
