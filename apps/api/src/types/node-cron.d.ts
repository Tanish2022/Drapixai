declare module 'node-cron' {
  export function schedule(cronExpression: string, task: () => void): cron.ScheduledTask;
  
  namespace cron {
    interface ScheduledTask {
      stop(): void;
      start(): void;
    }
  }
}