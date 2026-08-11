import type { ApiError } from '@/lib/types';

export class ApiTransactionAbort extends Error {
  constructor(
    readonly body: ApiError,
    readonly status: number,
  ) {
    super(body.error);
    this.name = 'ApiTransactionAbort';
  }
}

export function abortApiTransaction(body: ApiError, status: number): never {
  throw new ApiTransactionAbort(body, status);
}

export function transactionAbortResponse(error: unknown): Response | undefined {
  if (!(error instanceof ApiTransactionAbort)) return undefined;
  return Response.json(error.body, { status: error.status });
}
