export class OperationTimeoutError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'OperationTimeoutError';
  }
}

export const withOperationTimeout = <T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutCode: string,
): Promise<T> => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new OperationTimeoutError(timeoutCode)), timeoutMs);

  operation.then(
    (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    (error) => {
      clearTimeout(timer);
      reject(error);
    },
  );
});
