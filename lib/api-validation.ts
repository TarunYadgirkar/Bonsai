import { EFFORTS, MODELS } from './models';
import type {
  BranchRequest,
  ChatRequest,
  Effort,
  MergeRequest,
  ModeSelection,
  Tier,
} from './types';

const MAX_JSON_BYTES = 64 * 1024;
const MAX_ID_LENGTH = 160;
const MAX_TITLE_LENGTH = 160;
const MAX_TEXT_LENGTH = 20_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const VALID_TIERS = new Set<Tier>(['quick', 'thoughtful', 'deep']);
const VALID_EFFORTS = new Set<Effort>(EFFORTS.map((effort) => effort.level));
const VALID_MODELS = new Set(MODELS.map((model) => model.id));

interface ValidationError {
  ok: false;
  status: 400 | 413;
  error: string;
}

interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationError;

type JsonObject = Record<string, unknown>;

export async function parseBranchRequest(
  request: Request,
): Promise<ValidationResult<BranchRequest>> {
  return parseRequest(request, (body) => {
    const parentId = requiredId(body, 'parentId');
    if (!parentId.ok) return parentId;
    const selection = requiredString(body, 'selection', MAX_TEXT_LENGTH);
    if (!selection.ok) return selection;
    const question = optionalString(body, 'question', MAX_TEXT_LENGTH);
    if (!question.ok) return question;
    const title = optionalString(body, 'title', MAX_TITLE_LENGTH);
    if (!title.ok) return title;
    const mode = optionalMode(body.mode);
    if (!mode.ok) return mode;

    return {
      ok: true,
      value: {
        parentId: parentId.value,
        selection: selection.value,
        ...(question.value === undefined ? {} : { question: question.value }),
        ...(title.value === undefined ? {} : { title: title.value }),
        ...(mode.value === undefined ? {} : { mode: mode.value }),
      },
    };
  });
}

export async function parseChatRequest(request: Request): Promise<ValidationResult<ChatRequest>> {
  return parseRequest(request, (body) => {
    const branchId = requiredId(body, 'branchId');
    if (!branchId.ok) return branchId;
    const content = requiredString(body, 'content', MAX_TEXT_LENGTH);
    if (!content.ok) return content;
    const mode = optionalMode(body.mode);
    if (!mode.ok) return mode;

    let pinnedTier: Tier | null | undefined;
    if (Object.hasOwn(body, 'pinnedTier')) {
      if (body.pinnedTier === null) pinnedTier = null;
      else if (typeof body.pinnedTier === 'string' && VALID_TIERS.has(body.pinnedTier as Tier)) {
        pinnedTier = body.pinnedTier as Tier;
      } else {
        return invalid('pinnedTier must be quick, thoughtful, deep, or null');
      }
    }

    return {
      ok: true,
      value: {
        branchId: branchId.value,
        content: content.value,
        ...(pinnedTier === undefined ? {} : { pinnedTier }),
        ...(mode.value === undefined ? {} : { mode: mode.value }),
      },
    };
  });
}

export async function parseMergeRequest(request: Request): Promise<ValidationResult<MergeRequest>> {
  return parseRequest(request, (body) => {
    const branchId = requiredId(body, 'branchId');
    if (!branchId.ok) return branchId;
    if (Object.hasOwn(body, 'archive') && typeof body.archive !== 'boolean') {
      return invalid('archive must be a boolean');
    }

    return {
      ok: true,
      value: {
        branchId: branchId.value,
        ...(typeof body.archive === 'boolean' ? { archive: body.archive } : {}),
      },
    };
  });
}

export async function parseConversationRequest(
  request: Request,
): Promise<ValidationResult<{ title?: string }>> {
  return parseRequest(request, (body) => {
    const title = optionalString(body, 'title', MAX_TITLE_LENGTH);
    if (!title.ok) return title;
    return {
      ok: true,
      value: title.value === undefined ? {} : { title: title.value },
    };
  });
}

async function parseRequest<T>(
  request: Request,
  validate: (body: JsonObject) => ValidationResult<T>,
): Promise<ValidationResult<T>> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') return invalid('content-type must be application/json');

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    return tooLarge();
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) return tooLarge();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return invalid('request body must be valid JSON');
  }
  if (!isRecord(parsed)) return invalid('request body must be a JSON object');
  return validate(parsed);
}

function requiredId(body: JsonObject, key: string): ValidationResult<string> {
  const value = requiredString(body, key, MAX_ID_LENGTH);
  if (!value.ok) return value;
  if (!ID_PATTERN.test(value.value)) return invalid(`${key} must be a valid ID`);
  return value;
}

function requiredString(
  body: JsonObject,
  key: string,
  maxLength: number,
): ValidationResult<string> {
  if (typeof body[key] !== 'string') return invalid(`${key} must be a string`);
  const value = body[key].trim();
  if (!value) return invalid(`${key} must not be empty`);
  if (value.length > maxLength) return invalid(`${key} is too long`);
  return { ok: true, value };
}

function optionalString(
  body: JsonObject,
  key: string,
  maxLength: number,
): ValidationResult<string | undefined> {
  if (!Object.hasOwn(body, key)) return { ok: true, value: undefined };
  return requiredString(body, key, maxLength);
}

function optionalMode(value: unknown): ValidationResult<ModeSelection | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) return invalid('mode must be an object');
  if (value.mode === 'auto') {
    if (value.model !== undefined || value.effort !== undefined) {
      return invalid('auto mode must not specify model or effort');
    }
    return { ok: true, value: { mode: 'auto' } };
  }
  if (value.mode !== 'manual') return invalid('mode must be auto or manual');
  if (typeof value.model !== 'string' || !VALID_MODELS.has(value.model)) {
    return invalid('manual mode must specify a supported model');
  }
  if (value.effort !== undefined && !VALID_EFFORTS.has(value.effort as Effort)) {
    return invalid('manual mode effort is invalid');
  }
  return {
    ok: true,
    value: {
      mode: 'manual',
      model: value.model,
      ...(value.effort === undefined ? {} : { effort: value.effort as Effort }),
    },
  };
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(error: string): ValidationError {
  return { ok: false, status: 400, error };
}

function tooLarge(): ValidationError {
  return { ok: false, status: 413, error: 'request body is too large' };
}
