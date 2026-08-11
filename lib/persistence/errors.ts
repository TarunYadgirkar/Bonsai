export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

export class PersistenceSchemaError extends PersistenceError {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceSchemaError';
  }
}
