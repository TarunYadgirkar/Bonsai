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

export class PersistenceConfigurationError extends PersistenceError {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceConfigurationError';
  }
}

export class PersistenceLoadError extends PersistenceError {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceLoadError';
  }
}

export class PersistenceCommitError extends PersistenceError {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceCommitError';
  }
}

export class PersistenceConflictError extends PersistenceCommitError {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceConflictError';
  }
}

export class PersistenceUncertainCommitError extends PersistenceCommitError {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceUncertainCommitError';
  }
}
