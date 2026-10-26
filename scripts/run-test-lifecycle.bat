@echo off
set DATABASE_URL=postgresql://postgres:smart123@localhost:5432/smart_queue_test?schema=public
set REDIS_URL=redis://127.0.0.1:6379/15
set SESSION_SECRET=test-secret-for-integration-test-only
echo Using DATABASE_URL=***@localhost:5432/smart_queue_test
echo Using REDIS_URL=redis://127.0.0.1:6379/15
call npx tsx scripts/test-lifecycle-runtime.ts
exit /b %ERRORLEVEL%
