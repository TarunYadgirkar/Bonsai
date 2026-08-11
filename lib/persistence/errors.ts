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

export class PersistenceUnsupportedSchemaError extends PersistenceSchemaError {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceUnsupportedSchemaError';
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

export class PersistenceCorruptionError extends PersistenceLoadError {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceCorruptionError';
  }
}

export class PersistenceUnsafePathError extends PersistenceLoadError {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceUnsafePathError';
  }
}

export class PersistenceRecoveryError extends PersistenceLoadError {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceRecoveryError';
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
