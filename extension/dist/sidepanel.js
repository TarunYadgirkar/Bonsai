"use strict";
(() => {
  // ../packages/engine/src/tokens.ts
  function estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }
  function prunedPct(available, kept) {
    if (available <= 0) return 0;
    return Math.max(0, Math.round((available - kept) / available * 1e3) / 10);
  }

  // ../packages/engine/src/models.ts
  var MODELS = [
    {
      id: "claude-haiku-4-5",
      label: "Haiku 4.5",
      tier: "quick",
      input: 1,
      output: 5,
      blurb: "Fastest and cheapest. Fact lookups answerable straight from the brief."
    },
    {
      id: "claude-sonnet-5",
      label: "Sonnet 5",
      tier: "thoughtful",
      input: 3,
      output: 15,
      blurb: "Balanced. Synthesis and explanation across a handful of facts."
    },
    {
      id: "claude-opus-5",
      label: "Opus 5",
      tier: "deep",
      input: 5,
      output: 25,
      blurb: "Deep reasoning. Multi-constraint ranking and weighing trade-offs."
    },
    {
      id: "claude-fable-5",
      label: "Fable 5",
      tier: "deep",
      input: 10,
      output: 50,
      blurb: "The ceiling. Where a deep answer goes when it still is not good enough."
    }
  ];
  var EFFORTS = [
    { level: "low", label: "Low", maxTokens: 300, note: "single pass, no self-check" },
    { level: "medium", label: "Medium", maxTokens: 700, note: "one self-check" },
    { level: "high", label: "High", maxTokens: 1500, note: "multi-step reasoning" },
    { level: "max", label: "Max", maxTokens: 3e3, note: "exhaustive, weighs alternatives" }
  ];
  var TIER_DEFAULTS = {
    quick: { model: "claude-haiku-4-5", effort: "low" },
    thoughtful: { model: "claude-sonnet-5", effort: "medium" },
    deep: { model: "claude-opus-5", effort: "high" }
  };
  var MODEL_TIERS = {
    quick: TIER_DEFAULTS.quick.model,
    thoughtful: TIER_DEFAULTS.thoughtful.model,
    deep: TIER_DEFAULTS.deep.model
  };
  function modelSpec(id) {
    return MODELS.find((m) => m.id === id) ?? MODELS[0];
  }
  function effortSpec(level) {
    return EFFORTS.find((e) => e.level === level) ?? EFFORTS[0];
  }
  var INTERNAL_TIER = "quick";
  function costForModel(modelId, inputTokens, outputTokens) {
    const rate = modelSpec(modelId);
    const usd = (inputTokens * rate.input + outputTokens * rate.output) / 1e6;
    return Math.round(usd * 1e6) / 1e6;
  }
  var UPSTREAM_RATES = {
    "gpt-5.4-mini": { input: 0.75, output: 4.5 },
    "gpt-5.4": { input: 2.5, output: 15 },
    "gpt-5.5": { input: 5, output: 30 },
    "grok-4.3": { input: 1.25, output: 2.5 },
    "grok-4.5": { input: 2, output: 6 }
  };
  function costForServedBy(servedBy, bonsaiModelId, inputTokens, outputTokens) {
    const rate = servedBy ? UPSTREAM_RATES[servedBy] : void 0;
    if (!rate) return costForModel(bonsaiModelId, inputTokens, outputTokens);
    const usd = (inputTokens * rate.input + outputTokens * rate.output) / 1e6;
    return Math.round(usd * 1e6) / 1e6;
  }
  var MODEL_PRICING = {
    quick: { input: modelSpec(MODEL_TIERS.quick).input, output: modelSpec(MODEL_TIERS.quick).output },
    thoughtful: {
      input: modelSpec(MODEL_TIERS.thoughtful).input,
      output: modelSpec(MODEL_TIERS.thoughtful).output
    },
    deep: { input: modelSpec(MODEL_TIERS.deep).input, output: modelSpec(MODEL_TIERS.deep).output }
  };
  function effortNote(modelId, effort) {
    return `${modelSpec(modelId).label} \xB7 ${effortSpec(effort).label} effort \u2014 ${effortSpec(effort).note}`;
  }
  var TIER_EFFORT = {
    quick: effortNote(MODEL_TIERS.quick, "low"),
    thoughtful: effortNote(MODEL_TIERS.thoughtful, "medium"),
    deep: effortNote(MODEL_TIERS.deep, "high")
  };
  function routingLabel(modelId, effort) {
    return `${modelSpec(modelId).label} \xB7 ${effortSpec(effort).label} effort`;
  }
  var TIER_LABEL = {
    quick: routingLabel(TIER_DEFAULTS.quick.model, TIER_DEFAULTS.quick.effort),
    thoughtful: routingLabel(TIER_DEFAULTS.thoughtful.model, TIER_DEFAULTS.thoughtful.effort),
    deep: routingLabel(TIER_DEFAULTS.deep.model, TIER_DEFAULTS.deep.effort)
  };

  // src/provider-stub.ts
  async function providerComplete(_params) {
    return null;
  }

  // ../packages/engine/src/llm.ts
  async function complete(params) {
    const { tier, messages } = params;
    const model = params.model ?? MODEL_TIERS[tier];
    const effort = params.effort ?? TIER_DEFAULTS[tier].effort;
    const maxTokens = params.maxTokens ?? effortSpec(effort).maxTokens;
    const inputTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
    const live = await providerComplete({
      model,
      messages,
      maxTokens,
      effort,
      temperature: params.temperature
    });
    if (live) {
      const usedInput = live.inputTokens || inputTokens;
      const usedOutput = live.outputTokens || estimateTokens(live.text);
      return {
        text: live.text,
        model,
        tier,
        inputTokens: usedInput,
        outputTokens: usedOutput,
        estCostUsd: costForServedBy(live.servedBy, model, usedInput, usedOutput),
        mock: false,
        servedBy: live.servedBy
      };
    }
    return mockComplete(tier, model, messages, inputTokens, params.purpose);
  }
  function mockComplexity(prompt) {
    const question = /Question:\s*(.*)$/m.exec(prompt)?.[1] ?? prompt;
    const q = question.toLowerCase();
    if (/rank|compare|trade-?off|opportunity cost|given (my|everything)|top \d/.test(q)) return 3;
    const words = q.trim().split(/\s+/).length;
    if (words > 24) return 3;
    if (words > 12) return 2;
    return 1;
  }
  var KIND_CUES = [
    { kind: "comparison", cue: /\b(rank(s|ed|ing)?|compar(e|es|ed|ison)|vs|versus|which of|trade-?offs?)\b/ },
    { kind: "code", cue: /\b(rewrite|refactor|debug|code|function|bug|implement)\b/ },
    { kind: "creative", cue: /\b(write|draft|story|poem|creative)\b/ },
    { kind: "synthesis", cue: /\b(why|explain|summar\w*)\b/ },
    { kind: "lookup", cue: /\b(when|what|where|who|how many|deadline|list)\b/ }
  ];
  var CLEAR_CUE_CONFIDENCE = 0.85;
  var STRUCTURAL_CUE_CONFIDENCE = 0.6;
  var UNCLEAR_CONFIDENCE = 0.4;
  var LOOKUP_MAX_WORDS = 12;
  var REASONING_MIN_WORDS = 16;
  var REASONING_MIN_CLAUSES = 3;
  function mockKind(question) {
    const q = question.toLowerCase();
    const words = q.trim().split(/\s+/).filter(Boolean).length;
    const matched = KIND_CUES.filter(
      ({ kind, cue }) => cue.test(q) && (kind !== "lookup" || words <= LOOKUP_MAX_WORDS)
    );
    if (matched.length === 1) return { kind: matched[0].kind, confidence: CLEAR_CUE_CONFIDENCE };
    if (matched.length > 1) return { kind: matched[0].kind, confidence: UNCLEAR_CONFIDENCE };
    const clauses = q.split(/,|;|\band\b/).filter((part) => part.trim().length > 0).length;
    if (words >= REASONING_MIN_WORDS && clauses >= REASONING_MIN_CLAUSES) {
      return { kind: "reasoning", confidence: STRUCTURAL_CUE_CONFIDENCE };
    }
    return { kind: "other", confidence: UNCLEAR_CONFIDENCE };
  }
  var MOCK_FACT_COUNT = 6;
  var STOPWORDS = new Set(
    "the a an and or but if of to in on for with about from into over after is are was were be been do does did what when where which who whom how why my your our their this that these those i you he she it we they me him her us them can could should would will shall may might must not have has had all any some more most other than then them there here also just only very much".split(" ")
  );
  function keywords(text) {
    const words = text.toLowerCase().match(/[a-z][a-z0-9'@&+-]{2,}/g) ?? [];
    return [...new Set(words.filter((w) => !STOPWORDS.has(w)))];
  }
  function relevance(candidate, terms) {
    const hay = candidate.toLowerCase();
    return terms.reduce((n, t) => hay.includes(t) ? n + 1 : n, 0);
  }
  function sentencesOf(transcript) {
    return transcript.split("\n").map((line) => line.replace(/^(user|assistant|system):\s*/i, "").trim()).flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z])/)).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 30 && s.length < 320);
  }
  var TOPIC_MENTION_WEIGHT = 3;
  function rankByRelevance(candidates, terms, limit, topic, minScore = 1) {
    const needle = topic?.trim().toLowerCase();
    return candidates.map((text, i) => {
      const mentions = needle && text.toLowerCase().includes(needle) ? TOPIC_MENTION_WEIGHT : 0;
      return { text, score: relevance(text, terms) + mentions, i };
    }).filter((c) => c.score >= minScore).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((c) => c.text);
  }
  var RECENCY_WEIGHT = 0.5;
  var ROLE_FACT_WEIGHT = 0.75;
  var CONSTRAINT_CUE = /\b(must|need|want|only|at most|at least|no more than|cap|capped|cannot|can't|won't|budget|prefer|require|hard)\b/i;
  function sentencesWithRole(transcript) {
    let role = "unknown";
    const out = [];
    for (const line of transcript.split("\n")) {
      const tag = /^(user|assistant|system):\s*/i.exec(line);
      if (tag) role = tag[1].toLowerCase();
      const body = line.replace(/^(user|assistant|system):\s*/i, "");
      for (const raw of body.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
        const text = raw.replace(/\s+/g, " ").trim();
        if (text.length > 30 && text.length < 320) out.push({ text, role });
      }
    }
    return out;
  }
  function rarityWeights(sentences, terms) {
    const lower = sentences.map((s) => s.toLowerCase());
    const total = Math.max(1, lower.length);
    const weights = /* @__PURE__ */ new Map();
    for (const term of terms) {
      const inSentences = lower.filter((s) => s.includes(term)).length;
      weights.set(term, 1 + Math.log(total / Math.max(1, inSentences)));
    }
    return weights;
  }
  function roleWeight(sentence) {
    if (sentence.text.endsWith("?")) return 0;
    if (sentence.role === "assistant") return ROLE_FACT_WEIGHT;
    if (sentence.role === "user" && CONSTRAINT_CUE.test(sentence.text)) return ROLE_FACT_WEIGHT;
    return 0;
  }
  function rankBySalience(sentences, terms, limit, topic) {
    const needle = topic?.trim().toLowerCase();
    const rarity = rarityWeights(sentences.map((s) => s.text), terms);
    const span = Math.max(1, sentences.length - 1);
    return sentences.map((sentence, i) => {
      const hay = sentence.text.toLowerCase();
      const termScore = terms.reduce(
        (sum, t) => hay.includes(t) ? sum + (rarity.get(t) ?? 0) : sum,
        0
      );
      const topicScore = needle && hay.includes(needle) ? TOPIC_MENTION_WEIGHT : 0;
      const relevant = termScore + topicScore;
      const score = relevant + RECENCY_WEIGHT * (i / span) + roleWeight(sentence);
      return { text: sentence.text, relevant, score, i };
    }).filter((c) => c.relevant > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((c) => c.text);
  }
  function mockCompilerJson(prompt) {
    const selection = /Branch topic \(highlighted text\):\s*(.*)$/m.exec(prompt)?.[1] ?? "";
    const question = /Branch question:\s*(.*)$/m.exec(prompt)?.[1] ?? "";
    const transcript = prompt.split(/^Parent conversation:$/m)[1] ?? "";
    const sentences = sentencesWithRole(transcript);
    const terms = keywords(`${selection} ${question}`);
    let facts = rankBySalience(sentences, terms, MOCK_FACT_COUNT, selection);
    if (!facts.length) {
      facts = sentences.filter((s) => !s.text.endsWith("?")).slice(0, MOCK_FACT_COUNT).map((s) => s.text);
    }
    return JSON.stringify({
      facts: facts.length ? facts : [`Topic in focus: ${selection || question || "this branch"}.`],
      excludedNote: `Excluded: the rest of the parent thread \u2014 everything not bearing on ${selection || "this branch"}.`
    });
  }
  function mockComplete(tier, model, messages, inputTokens, purpose) {
    const prompt = messages.map((m) => m.content).join("\n");
    const text = mockText(tier, prompt, purpose);
    const outputTokens = estimateTokens(text);
    return {
      text,
      model,
      tier,
      inputTokens,
      outputTokens,
      estCostUsd: costForModel(model, inputTokens, outputTokens),
      mock: true
    };
  }
  var DEADLINE_QUESTION = /\b(when|what date|deadline|due)\b.*\b(close|closes|due|deadline|apply|application)\b/i;
  var RANKING_QUESTION = /\b(rank|top \d|opportunity cost|compare)\b/i;
  var DEMO_ANSWERS = {
    deadline: "Free Ventures applications close **September 11**, with an info session on September 3. That is eight days between the session and the deadline \u2014 draft the application before September 3 rather than after.",
    ranking: "Ranked, with the opportunity cost of each:\n\n1. **Free Ventures** \u2014 the only option whose hours go into your own company. Cost: ~3-4 hrs/week of overhead and a September application window that collides with technical-org recruiting.\n2. **ML@B** \u2014 strongest technical peer group and the highest ceiling. Cost: 12-14 hrs/week once the first-semester education track is counted, with a three-week spike landing on November midterms.\n3. **Blueprint** \u2014 fits the 8-10 hr cap and has the strongest community. Cost: almost no technical stretch.\n\nCodebase is dominated in both branches; cut it and reclaim the application slot."
  };
  var FACTS_PER_TIER = { quick: 1, thoughtful: 3, deep: 5 };
  var ANSWER_MIN_SCORE = 2;
  function factsFromBrief(prompt) {
    const section = /## Relevant facts\n([\s\S]*?)(?:\n##|\n---|$)/.exec(prompt)?.[1] ?? "";
    return section.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
  }
  function mockAnswer(tier, prompt) {
    const question = prompt.split(/\n---\n/).pop()?.trim() ?? "";
    if (DEADLINE_QUESTION.test(question)) return DEMO_ANSWERS.deadline;
    if (RANKING_QUESTION.test(question)) return DEMO_ANSWERS.ranking;
    const facts = factsFromBrief(prompt);
    const onBrief = facts.length > 0;
    const body = prompt.split(/\n---\n/).slice(0, -1).join("\n---\n");
    const widened = /## Pulled from the parent thread[^\n]*\n([\s\S]*)$/.exec(body)?.[1] ?? "";
    const candidates = onBrief ? [...facts, ...sentencesOf(widened).filter((s) => !s.endsWith("?"))] : sentencesOf(body).filter((s) => !s.endsWith("?"));
    const hits = rankByRelevance(
      candidates,
      keywords(question),
      FACTS_PER_TIER[tier],
      void 0,
      ANSWER_MIN_SCORE
    );
    if (!hits.length) {
      return onBrief ? "The compiled brief for this branch does not cover that. Ask to pull more of the parent thread in, or branch again from the part of the conversation that does." : "The context here does not cover that yet \u2014 add what matters to the conversation and ask again.";
    }
    if (tier === "quick") return hits[0];
    return `${hits.map((h) => `- ${h}`).join("\n")}

That is what this branch's brief supports; anything beyond it would need more of the parent thread pulled in.`;
  }
  var INSIGHT_MAX_WORDS = 20;
  function mockDistill(prompt) {
    const topic = /Branch topic:\s*(.*)$/m.exec(prompt)?.[1] ?? "";
    const body = prompt.split(/^Branch topic:.*$/m).pop() ?? prompt;
    const statements = sentencesOf(body).filter((s) => !s.endsWith("?"));
    const best = rankByRelevance(statements, keywords(topic), 1, topic)[0];
    if (!best) return `No durable conclusion reached on ${topic || "this branch"}.`;
    const words = best.replace(/\*\*/g, "").split(/\s+/);
    return words.length <= INSIGHT_MAX_WORDS ? best.replace(/\*\*/g, "") : `${words.slice(0, INSIGHT_MAX_WORDS).join(" ")}\u2026`;
  }
  function classifierFacts(prompt) {
    const section = /Brief facts:\n([\s\S]*?)(?:\nQuestion:|$)/.exec(prompt)?.[1] ?? "";
    return section.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
  }
  function mockClassifierJson(prompt) {
    const complexity = mockComplexity(prompt);
    const question = /Question:\s*(.*)$/m.exec(prompt)?.[1] ?? "";
    const { kind, confidence } = mockKind(question);
    const facts = classifierFacts(prompt);
    const covered = !facts.length || rankByRelevance(facts, keywords(question), 1, void 0, ANSWER_MIN_SCORE).length > 0;
    return JSON.stringify({
      complexity,
      kind,
      covered,
      confidence,
      reason: "heuristic mock classifier"
    });
  }
  function mockText(tier, prompt, purpose) {
    switch (purpose) {
      case "classify":
        return mockClassifierJson(prompt);
      case "compile":
        return mockCompilerJson(prompt);
      case "merge":
        return mockDistill(prompt);
      case "chat":
        return mockAnswer(tier, prompt);
      default:
        break;
    }
    if (/"complexity"/i.test(prompt) || /^Context size:/m.test(prompt)) {
      return mockClassifierJson(prompt);
    }
    if (/"facts"/i.test(prompt) || /compile minimal context/i.test(prompt)) {
      return mockCompilerJson(prompt);
    }
    if (/single durable conclusion/i.test(prompt)) return mockDistill(prompt);
    return mockAnswer(tier, prompt);
  }

  // ../packages/engine/src/logger.ts
  var active = console;
  var logger = {
    warn: (...args) => active.warn(...args),
    error: (...args) => active.error(...args)
  };

  // ../packages/engine/src/compiler.ts
  var MAX_FACTS = 8;
  var DEFAULT_BRIEF_BUDGET_TOKENS = 800;
  async function compileBrief(params, deps = { complete }) {
    const { briefId, branchId, selection, question, availableTokens } = params;
    const budget = params.budgetTokens ?? DEFAULT_BRIEF_BUDGET_TOKENS;
    const { parsed, usage } = await runCompiler(params, deps);
    let facts = parsed.facts.slice(0, MAX_FACTS);
    let markdown = renderBrief({ selection, question, facts, profile: params.profile });
    while (facts.length > 1 && estimateTokens(markdown) > budget) {
      facts = facts.slice(0, -1);
      markdown = renderBrief({ selection, question, facts, profile: params.profile });
    }
    const briefTokens = estimateTokens(markdown);
    return {
      brief: {
        id: briefId,
        branchId,
        selection,
        markdown,
        facts,
        excludedNote: parsed.excludedNote,
        availableTokens,
        briefTokens,
        prunedPct: prunedPct(availableTokens, briefTokens),
        ...params.anchorMessageId ? { anchorMessageId: params.anchorMessageId } : {}
      },
      usage
    };
  }
  async function runCompiler(params, deps) {
    const profileLine = params.profile ? `${params.profile.name} \u2014 ${params.profile.context} Goals: ${params.profile.goals.join("; ")}.` : "unknown";
    const result = await deps.complete({
      tier: INTERNAL_TIER,
      purpose: "compile",
      maxTokens: 600,
      messages: [
        {
          role: "system",
          content: 'You compile minimal context briefs. Given the context above a conversation fork and a branch topic, extract ONLY the facts needed to answer the branch question, ordered most load-bearing first: state the ONE fact the question most depends on first, then the rest in falling order of importance. Prefer facts a smaller model could not infer without them \u2014 the names, numbers, dates, and constraints that exist only in this conversation \u2014 over anything general knowledge supplies. Resolve every referent so each fact stands alone without the parent \u2014 never write "apps", "it", "that club" where a name belongs. Facts under "Inherited context" or "Learned from branches" headings are pre-distilled: carry the relevant ones through rather than re-deriving them. Respond with JSON only: {"facts": string[], "excludedNote": string}. facts: at most 8 short self-contained sentences. excludedNote: one sentence naming what you deliberately left out.'
        },
        {
          role: "user",
          content: [
            `User profile: ${profileLine}`,
            `Branch topic (highlighted text): ${params.selection}`,
            `Branch question: ${params.question || params.selection}`,
            "",
            "Parent conversation:",
            params.pathMarkdown
          ].join("\n")
        }
      ]
    });
    return {
      parsed: parseCompilerOutput(result.text, params.selection),
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estCostUsd: result.estCostUsd,
        model: result.model ?? MODEL_TIERS[INTERNAL_TIER],
        mock: result.mock,
        ...result.servedBy ? { servedBy: result.servedBy } : {}
      }
    };
  }
  function parseCompilerOutput(text, selection) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        const json = JSON.parse(text.slice(start, end + 1));
        const facts = Array.isArray(json.facts) ? json.facts.filter((f) => typeof f === "string") : [];
        if (facts.length) {
          return {
            facts,
            excludedNote: typeof json.excludedNote === "string" ? json.excludedNote : "Excluded: the rest of the parent conversation."
          };
        }
      } catch {
      }
    }
    logger.warn("[compiler] unparseable output \u2014 using fallback facts");
    return {
      facts: [`Topic in focus: ${selection}.`],
      excludedNote: "Excluded: the rest of the parent conversation (compiler fallback)."
    };
  }
  function renderBrief(params) {
    const lines = [`# Branch brief \u2014 ${params.selection}`, ""];
    if (params.profile) {
      lines.push(`**User:** ${params.profile.name} \u2014 ${params.profile.context}`, "");
    }
    lines.push("## Relevant facts", ...params.facts.map((f) => `- ${f}`));
    lines.push("", `## Question`, params.question || params.selection);
    return lines.join("\n");
  }

  // ../packages/engine/src/learning.ts
  var QUESTION_KINDS = [
    "lookup",
    "synthesis",
    "comparison",
    "reasoning",
    "code",
    "creative",
    "other"
  ];
  var TIER_ORDER = ["quick", "thoughtful", "deep"];
  var MIN_MOVES = 3;
  var SHIFT_THRESHOLD = 0.6;
  var DOWNSHIFT_CONFIDENCE_FLOOR = 0.5;
  function emptyStat() {
    return { up: 0, down: 0, kept: 0, dropped: 0, moves: 0 };
  }
  function emptyTierStats() {
    return { quick: emptyStat(), thoughtful: emptyStat(), deep: emptyStat() };
  }
  function emptyProfile() {
    return { version: 2, tiers: emptyTierStats(), kinds: {} };
  }
  function numeric(n) {
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }
  function normalizeStat(raw) {
    const s = raw ?? {};
    return {
      up: numeric(s.up),
      down: numeric(s.down),
      kept: numeric(s.kept),
      dropped: numeric(s.dropped),
      moves: numeric(s.moves)
    };
  }
  function normalizeTierStats(raw) {
    const t = raw ?? {};
    return { quick: normalizeStat(t.quick), thoughtful: normalizeStat(t.thoughtful), deep: normalizeStat(t.deep) };
  }
  function normalizeProfile(raw) {
    const p = raw ?? {};
    const profile = {
      version: 2,
      tiers: normalizeTierStats(p.tiers),
      kinds: {}
    };
    const kinds = p.kinds ?? {};
    for (const kind of QUESTION_KINDS) {
      const k = kinds[kind];
      if (k) profile.kinds[kind] = normalizeTierStats(k);
    }
    return profile;
  }
  function step(tier, delta) {
    const i = TIER_ORDER.indexOf(tier);
    return TIER_ORDER[Math.max(0, Math.min(TIER_ORDER.length - 1, i + delta))];
  }
  function applyEvent(stat, event) {
    switch (event.kind) {
      case "override": {
        const from = TIER_ORDER.indexOf(event.classifiedTier);
        const to = TIER_ORDER.indexOf(event.chosenTier ?? event.classifiedTier);
        if (to > from) {
          stat.up += 1;
          stat.moves += 1;
        } else if (to < from) {
          stat.down += 1;
          stat.moves += 1;
        }
        break;
      }
      case "escalation":
        stat.up += 1;
        stat.moves += 1;
        break;
      case "merge":
        stat.kept += 1;
        break;
      case "abandon":
        stat.dropped += 1;
        break;
    }
  }
  function recordFeedback(profile, event) {
    const base = normalizeProfile(profile);
    const tiers = { ...base.tiers, [event.classifiedTier]: { ...base.tiers[event.classifiedTier] } };
    applyEvent(tiers[event.classifiedTier], event);
    const kinds = { ...base.kinds };
    if (event.questionKind) {
      const existing = kinds[event.questionKind] ?? emptyTierStats();
      const updated = { ...existing, [event.classifiedTier]: { ...existing[event.classifiedTier] } };
      applyEvent(updated[event.classifiedTier], event);
      kinds[event.questionKind] = updated;
    }
    return { version: 2, tiers, kinds };
  }
  function adjustForProfile(classifiedTier, profile, opts = {}) {
    const confidence = clampConfidence(opts.confidence);
    const pick = pickStat(profile, classifiedTier, opts.questionKind, opts.population);
    if (!pick) return { tier: classifiedTier, learned: false, source: "none", note: "" };
    const { stat, source, community } = pick;
    const threshold = Math.min(0.95, SHIFT_THRESHOLD + (1 - confidence) * 0.2);
    const upRate = stat.up / stat.moves;
    const downRate = stat.down / stat.moves;
    const who = community ? "The community has" : "You've";
    const where = source === "kind" ? `${opts.questionKind} ` : "";
    if (upRate >= threshold && classifiedTier !== "deep") {
      const tier = step(classifiedTier, 1);
      return {
        tier,
        learned: true,
        source,
        note: `${who} upgraded ${where}${classifiedTier} picks ${stat.up}/${stat.moves} times, so this one starts at ${tier}.`
      };
    }
    if (downRate >= threshold && classifiedTier !== "quick" && confidence >= DOWNSHIFT_CONFIDENCE_FLOOR) {
      const tier = step(classifiedTier, -1);
      return {
        tier,
        learned: true,
        source,
        note: `${who} downgraded ${where}${classifiedTier} picks ${stat.down}/${stat.moves} times, so this one starts at ${tier}.`
      };
    }
    return { tier: classifiedTier, learned: false, source: "none", note: "" };
  }
  function pickStat(profile, tier, kind, population) {
    const sources = [
      { profile, community: false },
      { profile: population, community: true }
    ];
    for (const { profile: prof, community } of sources) {
      if (!prof) continue;
      const p = normalizeProfile(prof);
      const kindStat = kind ? p.kinds[kind]?.[tier] : void 0;
      if (kindStat && kindStat.moves >= MIN_MOVES) return { stat: kindStat, source: "kind", community };
      const agg = p.tiers[tier];
      if (agg.moves >= MIN_MOVES) return { stat: agg, source: "aggregate", community };
    }
    return null;
  }
  function clampConfidence(c) {
    if (typeof c !== "number" || !Number.isFinite(c)) return 1;
    return Math.max(0, Math.min(1, c));
  }

  // ../packages/engine/src/router.ts
  var COMPLEXITY_BY_TIER = {
    quick: 1,
    thoughtful: 2,
    deep: 3
  };
  var TIER_BY_COMPLEXITY = {
    1: "quick",
    2: "thoughtful",
    3: "deep"
  };
  var DEFAULT_DEPS = { complete };
  async function route(params, deps = DEFAULT_DEPS) {
    const { question, contextTokens, pinnedTier } = params;
    const manual = params.mode?.mode === "manual" && params.mode.model ? params.mode : params.pinnedMode?.mode === "manual" && params.pinnedMode.model ? params.pinnedMode : null;
    if (manual?.model) {
      const model = modelSpec(manual.model);
      const effort = manual.effort ?? TIER_DEFAULTS[model.tier].effort;
      return decision({
        tier: model.tier,
        model: model.id,
        effort,
        complexity: model.tier === "deep" ? 3 : model.tier === "thoughtful" ? 2 : 1,
        contextTokens,
        reason: `You picked ${model.label} at ${effortSpec(effort).label} effort; classification skipped.`,
        overridden: true
      });
    }
    if (pinnedTier) {
      return decision({
        tier: pinnedTier,
        complexity: pinnedTier === "deep" ? 3 : pinnedTier === "thoughtful" ? 2 : 1,
        contextTokens,
        reason: `Branch pinned to ${TIER_LABEL[pinnedTier]} by you; classification skipped.`,
        overridden: true
      });
    }
    const { complexity, covered, kind, confidence, why } = await classify(params, deps);
    const classifiedTier = TIER_BY_COMPLEXITY[complexity];
    const adjusted = adjustForProfile(classifiedTier, params.profile, {
      questionKind: kind,
      confidence,
      population: params.population
    });
    const tier = adjusted.tier;
    const baseReason = `${why} A ${kind} question, complexity ${complexity}/3, against a ${contextTokens}-token brief.`;
    return decision({
      tier,
      complexity: COMPLEXITY_BY_TIER[tier],
      contextTokens,
      reason: adjusted.learned ? `${baseReason} ${adjusted.note}` : baseReason,
      overridden: false,
      coveredByBrief: covered,
      learned: adjusted.learned,
      classifiedTier,
      kind,
      confidence
    });
  }
  async function classify(params, deps) {
    const factsBlock = params.brief?.facts.length ? `
Brief facts:
${params.brief.facts.map((f) => `- ${f}`).join("\n")}` : "";
    const result = await deps.complete({
      tier: INTERNAL_TIER,
      purpose: "classify",
      maxTokens: 120,
      messages: [
        {
          role: "system",
          content: 'You classify a question so a router can pick the right model and effort, and judge whether the provided brief covers it.\ncomplexity: 1 = a single fact lookup answerable straight from the context; 2 = synthesis or explanation over a few facts; 3 = multi-constraint reasoning, ranking, or weighing trade-offs.\nkind: one of lookup | synthesis | comparison | reasoning | code | creative | other \u2014 the shape of the task.\ncovered: whether the brief facts contain what the question needs (true when no facts are provided).\nconfidence: 0.0\u20131.0, how sure you are of this read.\nRespond with JSON only: {"complexity": 1|2|3, "kind": "...", "covered": true|false, "confidence": 0.0-1.0, "reason": "<8 words>"}.'
        },
        {
          role: "user",
          content: `Context size: ${params.contextTokens} tokens.${factsBlock}
Question: ${params.question}`
        }
      ]
    });
    const parsed = parseClassifier(result.text);
    if (parsed) return parsed;
    logger.warn("[router] unparseable classifier output \u2014 defaulting to thoughtful");
    return {
      complexity: 2,
      covered: true,
      kind: "other",
      confidence: 0.3,
      why: "Classifier unclear; defaulted to the middle tier."
    };
  }
  function parseClassifier(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      const json = JSON.parse(text.slice(start, end + 1));
      const value = Number(json.complexity);
      if (value !== 1 && value !== 2 && value !== 3) return null;
      return {
        complexity: value,
        covered: typeof json.covered === "boolean" ? json.covered : true,
        kind: QUESTION_KINDS.includes(json.kind) ? json.kind : "other",
        confidence: typeof json.confidence === "number" && Number.isFinite(json.confidence) ? Math.max(0, Math.min(1, json.confidence)) : 1,
        why: typeof json.reason === "string" ? `${json.reason}.` : "Classified by the router."
      };
    } catch {
      return null;
    }
  }
  function decision(params) {
    const model = params.model ?? MODEL_TIERS[params.tier];
    const effort = params.effort ?? TIER_DEFAULTS[params.tier].effort;
    const outputTokens = Math.round(effortSpec(effort).maxTokens * 0.5);
    return {
      tier: params.tier,
      model,
      effort,
      modelLabel: modelSpec(model).label,
      label: routingLabel(model, effort),
      effortNote: effortNote(model, effort),
      contextTokens: params.contextTokens,
      estCostUsd: costForModel(model, params.contextTokens, outputTokens),
      reason: params.reason,
      complexity: params.complexity,
      escalated: params.escalated ?? false,
      overridden: params.overridden,
      ...params.coveredByBrief === void 0 ? {} : { coveredByBrief: params.coveredByBrief },
      ...params.learned ? { learned: true } : {},
      ...params.classifiedTier ? { classifiedTier: params.classifiedTier } : {},
      ...params.kind ? { kind: params.kind } : {},
      ...params.confidence === void 0 ? {} : { confidence: params.confidence }
    };
  }

  // src/compile.ts
  function pathMarkdown(turns) {
    return turns.map((t) => `${t.role}: ${t.text}`).join("\n\n");
  }
  async function compileBranch(params) {
    const markdown = pathMarkdown(params.turns);
    const availableTokens = estimateTokens(markdown);
    const { brief } = await compileBrief({
      briefId: `x_${crypto.randomUUID().slice(0, 8)}`,
      branchId: `x_${crypto.randomUUID().slice(0, 8)}`,
      pathMarkdown: markdown,
      selection: params.selection,
      question: params.question || params.selection,
      availableTokens
    });
    if (params.selection && !brief.facts.some((f) => f.includes(params.selection))) {
      brief.facts = [`In focus: ${params.selection}.`, ...brief.facts].slice(0, 8);
      brief.markdown = brief.markdown.replace(
        "## Relevant facts",
        `## Relevant facts
- In focus: ${params.selection}.`
      );
    }
    const routing = await route({
      question: params.question || params.selection,
      brief,
      contextTokens: brief.briefTokens,
      profile: params.profile
    });
    return { brief, routing };
  }
  function branchPrompt(brief, question) {
    return [
      brief.markdown,
      "",
      "---",
      "Answer using only the compiled brief above. If it genuinely lacks something, say so plainly.",
      "",
      question || brief.selection
    ].join("\n");
  }
  function mergePrompt(insight) {
    return `Insight from a side branch: ${insight}`;
  }

  // src/render.ts
  var GLYPH = {
    draft: "\u25CC",
    open: "\u25CB",
    merged: "\u2713",
    abandoned: "\u2715"
  };
  function escapeHtml(s) {
    return s.replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }
  function nodeCardHtml(node) {
    return `
    <div class="title"><span class="glyph-${node.status}">${GLYPH[node.status]}</span> ${escapeHtml(node.title)}</div>
    <div class="meta"><span class="chip">${escapeHtml(node.modelLabel)} \xB7 ${escapeHtml(node.effort)}</span>
      ~${node.availableTokens}\u2192${node.briefTokens} tok \xB7 ${node.prunedPct}% pruned \xB7 ${escapeHtml(node.status)}</div>
    ${node.insight ? `<div class="insight">\u21B3 ${escapeHtml(node.insight)}</div>` : ""}
  `;
  }
  function renderTreeInto(container, nodes) {
    const sorted = [...nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (!sorted.length) {
      container.innerHTML = '<p class="empty">No branches yet.</p>';
      return [];
    }
    container.innerHTML = "";
    const out = [];
    for (const node of sorted) {
      const el = document.createElement("div");
      el.className = "node";
      el.innerHTML = nodeCardHtml(node);
      container.appendChild(el);
      out.push({ node, el });
    }
    return out;
  }

  // src/store.ts
  var NODES_KEY = "bonsai:nodes";
  var PROFILE_KEY = "bonsai:profile";
  async function listNodes() {
    const got = await chrome.storage.local.get(NODES_KEY);
    return got[NODES_KEY] ?? [];
  }
  async function putNode(node) {
    const nodes = await listNodes();
    const next = nodes.filter((n) => n.id !== node.id);
    next.push(node);
    await chrome.storage.local.set({ [NODES_KEY]: next });
  }
  async function updateNode(id, patch) {
    const nodes = await listNodes();
    await chrome.storage.local.set({
      [NODES_KEY]: nodes.map((n) => n.id === id ? { ...n, ...patch } : n)
    });
  }
  async function loadProfile() {
    const got = await chrome.storage.local.get(PROFILE_KEY);
    return got[PROFILE_KEY] ?? emptyProfile();
  }
  async function saveProfile(profile) {
    await chrome.storage.local.set({ [PROFILE_KEY]: profile });
  }

  // src/sidepanel.ts
  var $ = (id) => document.getElementById(id);
  var TIERS = ["quick", "thoughtful", "deep"];
  async function activeTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  }
  async function toContent(msg) {
    const id = await activeTabId();
    if (id === void 0) return void 0;
    try {
      return await chrome.tabs.sendMessage(id, msg);
    } catch {
      return void 0;
    }
  }
  var lastCompiled = null;
  var selectionConversationId = null;
  async function compile() {
    const selection = $("selection").value.trim();
    const question = $("question").value.trim();
    const status = $("compile-status");
    if (!selection && !question) {
      status.textContent = "Add a selection or a question first.";
      return;
    }
    status.textContent = "Reading the conversation\u2026";
    const active2 = await toContent({ type: "GET_ACTIVE" });
    if (!active2?.conversationId) {
      status.textContent = "Open a Claude chat first, then compile.";
      return;
    }
    if (selectionConversationId && selectionConversationId !== active2.conversationId) {
      status.textContent = "That selection was from a different chat \u2014 reselect text in this one.";
      selectionConversationId = null;
      return;
    }
    const treeRes = await toContent({ type: "GET_TREE", conversationId: active2.conversationId });
    if (!treeRes || !treeRes.ok) {
      status.textContent = `Could not read the chat${treeRes ? `: ${treeRes.reason}` : ""}.`;
      return;
    }
    const profile = await loadProfile();
    const compiled = await compileBranch({
      turns: treeRes.tree.path,
      selection,
      question,
      profile
    });
    lastCompiled = compiled;
    status.textContent = "";
    renderPreview(compiled, active2.conversationId, treeRes.tree.name);
  }
  function renderPreview(compiled, parentConversationId, parentName) {
    const { brief, routing } = compiled;
    const preview = $("preview");
    const recommended = routing.tier;
    preview.innerHTML = "";
    const box = document.createElement("div");
    box.className = "brief";
    box.innerHTML = `
    <strong>Compiled brief</strong>
    <ul>${brief.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
    <div class="excluded">${escapeHtml(brief.excludedNote)}</div>
    <div class="econ">~${brief.availableTokens} tokens available \u2192 ${brief.briefTokens} in the brief \xB7 ${brief.prunedPct}% pruned</div>
  `;
    const label = document.createElement("label");
    label.textContent = "Model & effort (Bonsai picked this \u2014 change it to teach the router)";
    const select = document.createElement("select");
    for (const t of TIERS) {
      const d = TIER_DEFAULTS[t];
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = routingLabel(d.model, d.effort);
      if (t === recommended) opt.selected = true;
      select.appendChild(opt);
    }
    if (routing.learned) {
      const note = document.createElement("div");
      note.className = "econ";
      note.textContent = `Learned: ${routing.reason.split(". ").pop() ?? ""}`;
      box.appendChild(note);
    }
    const open = document.createElement("button");
    open.textContent = "Open branch chat \u2192";
    open.style.marginTop = "10px";
    open.addEventListener(
      "click",
      () => openBranch(brief, routing, select.value, recommended, parentConversationId, parentName)
    );
    preview.appendChild(box);
    preview.appendChild(label);
    preview.appendChild(select);
    preview.appendChild(open);
  }
  async function openBranch(brief, routing, chosenTier, recommendedTier, parentConversationId, parentName) {
    if (chosenTier !== recommendedTier) {
      const profile = await loadProfile();
      await saveProfile(
        recordFeedback(profile, {
          kind: "override",
          classifiedTier: routing.classifiedTier ?? recommendedTier,
          chosenTier,
          questionKind: routing.kind
        })
      );
    }
    const model = TIER_DEFAULTS[chosenTier].model;
    const effort = TIER_DEFAULTS[chosenTier].effort;
    const question = $("question").value.trim() || brief.selection;
    const node = {
      id: `n_${crypto.randomUUID().slice(0, 8)}`,
      conversationId: null,
      parentConversationId,
      title: (question || brief.selection).slice(0, 60),
      selection: brief.selection,
      question,
      briefMarkdown: brief.markdown,
      facts: brief.facts,
      excludedNote: brief.excludedNote,
      availableTokens: brief.availableTokens,
      briefTokens: brief.briefTokens,
      prunedPct: brief.prunedPct,
      tier: chosenTier,
      model,
      modelLabel: modelSpec(model).label,
      effort,
      status: "draft",
      insight: null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await putNode(node);
    await chrome.runtime.sendMessage({
      type: "OPEN_PREFILL",
      url: "https://claude.ai/new",
      text: branchPrompt(brief, question),
      nodeId: node.id
    });
    $("selection").value = "";
    $("question").value = "";
    $("preview").innerHTML = "";
    void parentName;
    await renderTree();
  }
  async function renderTree() {
    const rendered = renderTreeInto($("tree"), await listNodes());
    for (const { node, el } of rendered) {
      if (node.status === "open" || node.status === "draft") el.appendChild(mergeControls(node));
    }
  }
  function mergeControls(node) {
    const wrap = document.createElement("div");
    wrap.style.marginTop = "8px";
    const ta = document.createElement("textarea");
    ta.rows = 2;
    ta.placeholder = "One distilled insight to merge back to the parent\u2026";
    const row = document.createElement("div");
    row.className = "row";
    row.style.marginTop = "6px";
    const send = document.createElement("button");
    send.textContent = "\u2934 Merge to parent";
    send.addEventListener("click", async () => {
      const insight = ta.value.trim();
      if (!insight) return;
      await updateNode(node.id, { status: "merged", insight });
      await chrome.runtime.sendMessage({
        type: "OPEN_PREFILL",
        url: `https://claude.ai/chat/${node.parentConversationId}`,
        text: mergePrompt(insight)
      });
      await renderTree();
    });
    const drop = document.createElement("button");
    drop.className = "ghost";
    drop.textContent = "Abandon";
    drop.addEventListener("click", async () => {
      await updateNode(node.id, { status: "abandoned" });
      await renderTree();
    });
    row.appendChild(send);
    row.appendChild(drop);
    wrap.appendChild(ta);
    wrap.appendChild(row);
    return wrap;
  }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "SELECTION") {
      $("selection").value = msg.text;
      selectionConversationId = msg.conversationId ?? null;
      $("question").focus();
    }
  });
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "local") void renderTree();
  });
  $("compile").addEventListener("click", () => void compile());
  void renderTree();
})();
//# sourceMappingURL=sidepanel.js.map
