import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import { ArrowLeft, ArrowRight, Check, Lightbulb, Sparkles } from "lucide-react";
import "../styles/CreateCompetition.css";
import "../styles/createCompetitionRefresh.css";
import DatasetSection from "./DatasetSection";
import { supabase } from "../config/supabase";
import { notify, formatApiError } from "../components/Notify";

/** Always returns a fresh, valid access token from Supabase session */
async function getFreshToken() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session?.access_token) return null;
    return data.session.access_token;
}

// The wizard is dynamic: Tracks, Phases, and Data Collection are independent
// capabilities an organizer can turn on separately, each adding its own step.
// Milestones has been removed as a concept — Phases (an ordered, named,
// organizer-defined timeline) is the only timeline mechanism now. A
// competition that doesn't enable Phases simply uses its start/end dates,
// with no fabricated timeline shown anywhere.
function getSteps(form) {
    const s = [
        { key: "basic", label: "Basic Info" },
        { key: "assets", label: "Sample Assets" },
        { key: "tasks", label: "Tasks" },
    ];
    if (form.participantSourcedData) {
        s.push({ key: "dataCollection", label: "Data Collection" });
    }
    if (form.tracksEnabled) {
        s.push({ key: "tracks", label: "Tracks" });
    }
    if (form.phasesEnabled) {
        s.push({ key: "phases", label: "Phases" });
    }
    if (form.participantSourcedData) {
        s.push({ key: "license", label: "License" });
    }
    s.push({ key: "evaluation", label: "Evaluation" });
    s.push({ key: "rules", label: "Rules" });
    s.push({ key: "complexity", label: "Complexity" });
    // When Data Collection is enabled, participants source their own raw data —
    // there's no organizer-provided dataset to demand, since the data collected
    // from participants is what gets used for training and evaluation instead.
    if (!form.participantSourcedData) {
        s.push({ key: "datasets", label: "Datasets" });
    }
    return s;
}

// Source types a team can pull participant-sourced data from (generic, not audio-specific)
const SOURCE_TYPE_OPTIONS = [
    { value: "public_platform", label: "Public platform (YouTube, etc.)" },
    { value: "self_recorded", label: "Recorded / written by the participant" },
    { value: "existing_dataset", label: "Existing dataset the team adapts" },
];

// Largest "annotators per instance" accepted (keep in sync with MAX_ANNOTATORS_PER_INSTANCE in routes/competitions.py).
const MAX_ANNOTATORS = 25;

// Pages of the competition area (same keys as the sidebar in CompetitionSidebar.jsx).
// For each phase the organizer picks which of these members may open; the rest show as locked.
// "Support" is always open, so it isn't listed.
const PHASE_PAGES = [
    { key: "data-collection", label: "Data Collection" },
    { key: "data-annotation", label: "Annotation" },
    { key: "team-dataset", label: "Dataset" },
    { key: "dataset-hub", label: "Validation" },
    { key: "experiments", label: "Workspace" },
    { key: "experiment-registry", label: "Experiments" },
    { key: "leaderboard", label: "Leaderboard" },
    { key: "documentation", label: "Documentation" },
];
const ALL_PHASE_PAGE_KEYS = PHASE_PAGES.map((p) => p.key);

// Which kind of task answer each metric can score; used to warn when no task produces that kind of answer.
const METRIC_ANSWER_SHAPES = {
    "Accuracy": ["labels", "spans"],
    "F1 Score": ["labels", "spans"],
    "BLEU": ["text", "qa"],
    "ROUGE-L": ["text", "qa"],
    "WER": ["text", "qa"],
    "Exact Match": ["labels", "spans", "text", "qa"],
};
const SHAPE_NAMES = { labels: "label", spans: "span", text: "free-text", qa: "question/answer" };

// 1 → 1st, 2 → 2nd, 3 → 3rd, 11 → 11th, 21 → 21st …
function ordinal(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return `${n}th`;
    return `${n}${({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th"}`;
}

// Each team's data is annotated only by its own members, so "annotators per instance" can't
// exceed the smallest team accepted. An empty "Min Team Members" means teams of 1 are allowed.
function smallestTeam(minMembers) {
    const n = Number(minMembers);
    return Number.isInteger(n) && n >= 1 ? n : 1;
}

function annotatorLimitMessage(annotators, minMembers) {
    const min = smallestTeam(minMembers);
    return `Minimum team size: ${min}. Choose at most ${min} annotators, or raise the minimum team size to ${annotators}.`;
}

const primaryMetrics = [
    "Accuracy",
    "F1 Score",
    "BLEU",
    "ROUGE-L",
    "WER",
    "Exact Match",
];

// Generic on purpose: a competition has no fixed task type any more (its assets + tasks
// define it), so the levels describe difficulty, not one specific kind of task.
// Only the index is stored, so existing competitions keep their level.
const complexityLevels = [
    {
        title: "Level 1: Beginner",
        description: "One well-defined task on a single asset; standard baselines work out of the box",
    },
    {
        title: "Level 2: Intermediate",
        description: "A few tasks or assets, or labelling decisions that need some judgement",
    },
    {
        title: "Level 3: Advanced",
        description: "Several chained tasks or modalities; needs custom modelling work",
    },
    {
        title: "Level 4: Expert",
        description: "Complex multi-task / multi-modal pipeline with open research questions",
    },
];

const PREDEFINED_SKILLS = [
    "Natural Language Processing",
    "Computer Vision",
    "PyTorch",
    "TensorFlow",
    "Transformer Architecture",
    "Vector Databases",
    "Python",
    "CUDA",
    "Rust",
    "Go",
    "Docker",
    "Kubernetes",
    "FastAPI",
    "React",
    "Named Entity Recognition",
    "Automatic Speech Recognition",
    "Text Classification",
    "Data Annotation",
    "MLOps",
    "Fine-tuning",
    "Prompt Engineering",
];

// ── Generic assets + tasks ───────────────────────────────────────────────────
// A competition has no "type". It is defined by:
//   1. Sample Assets — the units of data one sample is made of (Text, Audio...),
//      each with its own constraints.
//   2. Tasks — generic operations (Transcription, Classification, NER...) that
//      each target an ASSET, the whole SAMPLE, or the TASK_OUTPUT of another
//      task, and may depend on earlier tasks (cycles are not allowed).
// The list of asset types, task types and each one's option schema comes from
// GET /competition-schema, so new ones need no change here.


function defaultsFromFields(fields = []) {
    const out = {};
    fields.forEach((f) => {
        if (f.default !== undefined) out[f.key] = Array.isArray(f.default) ? [...f.default] : f.default;
    });
    return out;
}

// Starting config for a task of this type: the field defaults, then the registry's
// suggestions (e.g. typical labels / entity types) on top. Everything stays editable.
function initialTaskConfig(spec) {
    const out = defaultsFromFields(spec?.fields);
    Object.entries(spec?.suggestions || {}).forEach(([k, v]) => {
        out[k] = Array.isArray(v) ? [...v] : v;
    });
    return out;
}

function nextKey(prefix, existing) {
    let n = 1;
    while (existing.includes(`${prefix}_${n}`)) n += 1;
    return `${prefix}_${n}`;
}

function isBlankValue(v) {
    return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function listFromValue(v) {
    const lines = Array.isArray(v) ? v : String(v || "").split("\n");
    return lines.map((s) => String(s).trim()).filter(Boolean);
}

// Direct dependencies of a task: its explicit "depends on" list plus, when it
// targets another task's output, that task.
function taskDeps(task) {
    const deps = [...(task.dependsOn || [])];
    if (task.targetType === "TASK_OUTPUT" && task.targetRef) deps.push(task.targetRef);
    return deps;
}

// true if task `fromKey` depends (directly or transitively) on `onKey`
function dependsTransitively(tasks, fromKey, onKey, seen = new Set()) {
    if (seen.has(fromKey)) return false;
    seen.add(fromKey);
    const t = tasks.find((x) => x.key === fromKey);
    if (!t) return false;
    return taskDeps(t).some((d) => d === onKey || dependsTransitively(tasks, d, onKey, seen));
}

function findTaskCycle(tasks) {
    const state = {};
    const stack = [];
    const visit = (key) => {
        state[key] = 1;
        stack.push(key);
        const t = tasks.find((x) => x.key === key);
        for (const d of t ? taskDeps(t) : []) {
            if (!tasks.some((x) => x.key === d)) continue;
            if (state[d] === 1) return [...stack.slice(stack.indexOf(d)), d];
            if (!state[d]) {
                const found = visit(d);
                if (found) return found;
            }
        }
        stack.pop();
        state[key] = 2;
        return null;
    };
    for (const t of tasks) {
        if (!state[t.key]) {
            const found = visit(t.key);
            if (found) return found;
        }
    }
    return null;
}

// A field with show_if only applies while another field has a given value
// (e.g. min/max labels only matter when "Allow multiple labels" is on).
function isFieldVisible(f, fields, values) {
    if (!f.show_if) return true;
    return Object.entries(f.show_if).every(([k, want]) => {
        const cur = values?.[k] ?? fields.find((x) => x.key === k)?.default;
        return Boolean(cur) === Boolean(want) && (typeof want !== "boolean" ? cur === want : true);
    });
}

// Validates a config object against a registry field list (mirrors the server).
function validateFieldValues(fields, values, errKey, errors, who) {
    fields.forEach((f) => {
        if (!isFieldVisible(f, fields, values)) return;
        const v = values?.[f.key];
        const name = `${who}: ${f.label}`;
        if (f.type === "string_list") {
            const n = listFromValue(v).length;
            const min = f.min_items ?? (f.required ? 1 : 0);
            if ((f.required || n > 0) && n < min)
                errors[`${errKey}-${f.key}`] = `${name} needs at least ${min} ${min === 1 ? "entry" : "entries"}.`;
            return;
        }
        if (f.type === "multi_select") {
            if (f.required && !(v || []).length) errors[`${errKey}-${f.key}`] = `${name}: select at least one.`;
            return;
        }
        if (isBlankValue(v)) {
            if (f.required) errors[`${errKey}-${f.key}`] = `${name} is required.`;
            return;
        }
        if (f.type === "integer" || f.type === "number") {
            const num = Number(v);
            if (Number.isNaN(num)) errors[`${errKey}-${f.key}`] = `${name} must be a number.`;
            else if (f.min !== undefined && num < f.min) errors[`${errKey}-${f.key}`] = `${name} must be at least ${f.min}.`;
            else if (f.max !== undefined && num > f.max) errors[`${errKey}-${f.key}`] = `${name} must be at most ${f.max}.`;
        }
    });
}

// Strip blanks and coerce so the payload is clean (server validates again).
function serializeFieldValues(fields, values) {
    const out = {};
    fields.forEach((f) => {
        if (!isFieldVisible(f, fields, values)) return;
        const v = values?.[f.key];
        if (isBlankValue(v)) return;
        if (f.type === "string_list") out[f.key] = listFromValue(v);
        else if (f.type === "integer") out[f.key] = parseInt(v, 10);
        else if (f.type === "number") out[f.key] = Number(v);
        else out[f.key] = v;
    });
    return out;
}

const initialForm = {
    competitionName: "",
    description: "",
    startDate: "",
    endDate: "",
    prizePool: "",

    primaryMetric: "",
    secondaryMetric: "",

    maxTeams: "",
    minMembers: "",
    maxMembers: "",
    mergeDeadline: "",
    requiredSkills: [],
    // How many TEAM members must have each required skill: { [skill]: number | "all" }.
    // A skill with no entry means "at least one member".
    teamSkillMembers: {},
    maxSubmissionsPerDay: "",
    allowExternalData: true,
    allowPretrainedModels: true,
    requireCodeSharing: false,
    additionalRules: "",

    complexityLevel: 0,

    // Join method: "auto" = automatic acceptance; "manual" = organizer approval required
    joinMethod: "auto",

    // What a sample is made of, and what is done on it (see helpers above).
    // assets: [{ id, key, name, type, required, constraints }]
    // tasks:  [{ id, key, name, type, targetType, targetRef, dependsOn, config, instructions }]
    assets: [],
    tasks: [],
    legacyTaskType: "",
    // Optional source prompts shown to contributors (one per line)
    prompts: "",

    // ── Independent platform capabilities ───────────────────────────────────────
    // Each of these can be turned on by itself; a competition can use any
    // combination (or none) of them, whatever the task type.

    // Tracks: split participants into fair comparison groups (region,
    // language, category...), each with a minimum team count to be viable.
    tracksEnabled: false,
    tracks: [],

    // Phases: an ordered, named timeline replacing the single start/end date
    // pair — for competitions with more than one stage (e.g. data collection
    // → break → training).
    phasesEnabled: false,
    phases: [
        {
            id: 1, name: "Data Collection & Annotation", durationDays: 14,
            description: "Collect and annotate data with your team. Model training opens in the next phase.",
            allowedPages: ["data-collection", "data-annotation", "team-dataset", "dataset-hub", "documentation"],
        },
        {
            id: 2, name: "Model Training & Leaderboard", durationDays: 10,
            description: "Train models on the validated dataset and submit them to the leaderboard.",
            allowedPages: ["experiments", "experiment-registry", "leaderboard", "documentation"],
        },
    ],

    // Data Collection: participants source, record, or adapt their own raw
    // data instead of using an organizer-provided dataset. A contributed
    // instance is a sample, so its inputs are the Sample Assets; this governs
    // allowed sources and the annotation protocol.
    participantSourcedData: false,
    dataCollection: {
        allowedSourceTypes: ["public_platform", "self_recorded"],
        requireProvenance: true,
        annotatorsPerInstance: 2,
        adjudicationEnabled: true,
    },

    // Mandatory data usage license — required whenever contributed data may be
    // published or reused beyond the contributing team. Only asked for when
    // Data Collection is enabled.
    license: {
        version: "v1.0",
        text: "",
    },

    // Evaluation scoring mode: "standard" (one submission score) or
    // "data_quality_plus_model" (a per-team data-quality score, from a
    // baseline trained on that team's data alone, combined with each team's
    // own model score).
    evaluationMode: "standard",
    dataQualityWeight: 50,
    modelWeight: 50,
    perTeamBaselineEnabled: false,
    publicTestFraction: 20,
    winnersPerTrack: 1,

    validationDate: "",
    freezeDate: "",
};

function safeArrayJson(value) {
    try {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function mapCompetitionToForm(c) {
    let taskConfig = {};
    try {
        if (c.dataset_config) {
            const raw = typeof c.dataset_config === "string" ? JSON.parse(c.dataset_config) : c.dataset_config;
            taskConfig = raw || {};
        }
    } catch {
        taskConfig = {};
    }

    // Tracks / Phases / Data Collection / License / Evaluation each ride as
    // their own flat keys inside dataset_config — independent of each other.
    const tracksCfg = taskConfig.tracks_enabled ? (taskConfig.tracks || []) : [];
    const phasesCfg = taskConfig.phases_enabled ? (taskConfig.phases || []) : null;
    const dataCollectionCfg = taskConfig.data_collection || {};
    const licenseCfg = taskConfig.license || {};
    const evalCfg = taskConfig.evaluation_scoring || {};

    return {
        competitionName: c.title || "",
        description: c.description || "",
        startDate: c.start_date || "",
        endDate: c.end_date || "",
        prizePool: c.prize_pool ?? "",

        primaryMetric: c.primary_metric || "",
        secondaryMetric: c.secondary_metric || "",

        maxTeams: c.max_teams ?? "",
        minMembers: c.min_members ?? "",
        maxMembers: c.max_members ?? "",
        mergeDeadline: c.merge_deadline || "",
        requiredSkills: safeArrayJson(c.required_skills),
        teamSkillMembers: taskConfig.team_requirements?.skill_members || {},
        maxSubmissionsPerDay: c.max_submissions_per_day ?? "",
        allowExternalData: c.allow_external_data ?? true,
        allowPretrainedModels: c.allow_pretrained_models ?? true,
        requireCodeSharing: c.require_code_sharing ?? false,
        additionalRules: c.additional_rules || "",

        complexityLevel: c.complexity_level ?? 0,

        joinMethod: c.join_method || "auto",

        assets: (c.assets || []).map((a) => ({
            id: a.id || a.key,
            key: a.key,
            name: a.name || "",
            type: a.type,
            required: a.required !== false,
            constraints: a.constraints || {},
        })),
        tasks: (c.tasks || []).map((t) => ({
            id: t.id || t.key,
            key: t.key,
            name: t.name || "",
            type: t.type,
            targetType: t.target?.type || "",
            targetRef: t.target?.ref || "",
            dependsOn: t.depends_on || [],
            config: t.config || {},
            instructions: t.instructions || "",
        })),
        prompts: "",

        tracksEnabled: !!taskConfig.tracks_enabled,
        tracks: tracksCfg,

        phasesEnabled: !!taskConfig.phases_enabled,
        phases: phasesCfg && phasesCfg.length
            ? phasesCfg.map((p) => ({ ...p, allowedPages: Array.isArray(p.allowedPages) ? p.allowedPages : ALL_PHASE_PAGE_KEYS }))
            : initialForm.phases,

        participantSourcedData: !!taskConfig.data_collection_enabled,
        // The instance inputs are NOT stored on the form: a contributed
        // instance is a sample, so its inputs are always the sample assets.
        dataCollection: {
            allowedSourceTypes: dataCollectionCfg.allowed_source_types || initialForm.dataCollection.allowedSourceTypes,
            requireProvenance: dataCollectionCfg.require_public_source_provenance ?? true,
            annotatorsPerInstance: dataCollectionCfg.annotators_per_instance ?? 2,
            adjudicationEnabled: dataCollectionCfg.adjudication_enabled ?? true,
        },
        license: {
            version: licenseCfg.version || initialForm.license.version,
            text: licenseCfg.text || "",
        },

        evaluationMode: evalCfg.mode || "standard",
        dataQualityWeight: evalCfg.data_quality_weight ?? 50,
        modelWeight: evalCfg.model_weight ?? 50,
        perTeamBaselineEnabled: !!evalCfg.per_team_baseline_enabled,
        publicTestFraction: evalCfg.public_test_fraction ?? 20,
        winnersPerTrack: evalCfg.winners_per_track ?? 1,

        validationDate: c.validation_date || "",
        freezeDate: c.freeze_date || "",
    };
}

function CreateCompetition({ editMode = false }) {
  useInterfaceLanguage();
    const navigate = useNavigate();
    const location = useLocation();
    const { competitionId } = useParams();

    const isEditMode = editMode || Boolean(competitionId);

    const [currentStep, setCurrentStep] = useState(0);
    const stepHeading = useRef(null);
    const previousStep = useRef(0);
    useEffect(() => {
        if (previousStep.current === currentStep) return;
        previousStep.current = currentStep;
        stepHeading.current?.focus({ preventScroll: true });
        stepHeading.current?.scrollIntoView({ block: "start" });
    }, [currentStep]);
    const [submitting, setSubmitting] = useState(false);
    const [loadingEditData, setLoadingEditData] = useState(isEditMode);
    const [form, setForm] = useState(initialForm);
    const [errors, setErrors] = useState({});
    const [skillsOpen, setSkillsOpen] = useState(false);

    const [savedCompetitionId, setSavedCompetitionId] = useState(
        isEditMode ? competitionId : null
    );
    const [savingDraft, setSavingDraft] = useState(false);
    const [draftError, setDraftError] = useState(null);
    const [draftAttempt, setDraftAttempt] = useState(0);
    // Source prompts live in their own table; in edit mode they are fetched into the textarea.
    // Until that has happened an empty box must NOT be sent (it would wipe the stored prompts).
    const [promptsLoaded, setPromptsLoaded] = useState(!isEditMode);

    const wizardSteps = getSteps(form);

    // If toggling a capability removes/adds steps, keep the current
    // step in range instead of pointing past the end of the array.
    useEffect(() => {
        if (currentStep > wizardSteps.length - 1) {
            setCurrentStep(wizardSteps.length - 1);
        }
    }, [wizardSteps.length]); // eslint-disable-line react-hooks/exhaustive-deps

    const progressPercent = ((currentStep + 1) / wizardSteps.length) * 100;

    useEffect(() => {
        if (!isEditMode) return;

        const competitionFromState = location.state?.competition;

        // The list view's payload has no assets/tasks — fetch the full record then.
        if (competitionFromState && Array.isArray(competitionFromState.assets)) {
            setForm((prev) => ({ ...mapCompetitionToForm(competitionFromState), prompts: prev.prompts }));
            setLoadingEditData(false);
            return;
        }

        async function loadCompetitionForEdit() {
            try {
                const token = await getFreshToken();

                if (!token) {
                    navigate("/login");
                    return;
                }

                const res = await fetch(
                    `http://127.0.0.1:8000/competitions/${competitionId}`,
                    { headers: { Authorization: `Bearer ${token}` } }
                );

                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.detail || "Could not load competition");
                }

                setForm((prev) => ({ ...mapCompetitionToForm(data), prompts: prev.prompts }));
            } catch (error) {
                console.error(error);
                notify.error("Could not load the competition", error.message);
                navigate("/competitions");
            } finally {
                setLoadingEditData(false);
            }
        }

        loadCompetitionForEdit();
    }, [isEditMode, location.state, competitionId, navigate]);

    // Edit mode: bring the stored source prompts back into the textarea.
    useEffect(() => {
        if (!isEditMode || !competitionId) return;
        let cancelled = false;
        (async () => {
            try {
                const token = await getFreshToken();
                if (!token) return;
                const res = await fetch(`http://127.0.0.1:8000/competitions/${competitionId}/prompts`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) return;
                const list = await res.json();
                if (cancelled) return;
                setForm((prev) => ({ ...prev, prompts: prev.prompts || list.map((x) => x.content).join("\n") }));
                setPromptsLoaded(true);
            } catch (e) {
                console.error("Could not load source prompts", e);
            }
        })();
        return () => { cancelled = true; };
    }, [isEditMode, competitionId]);

    // Auto-save draft when reaching the Datasets step (its index shifts depending
    // on which capability steps are currently present).
    useEffect(() => {
        if (wizardSteps[currentStep]?.key !== "datasets") return;
        if (isEditMode) return;
        if (savedCompetitionId) return;

        async function saveDraftAuto() {
            const token = await getFreshToken();
            if (!token) return;

            setSavingDraft(true);
            setDraftError(null);

            try {
                const r = await fetch("http://127.0.0.1:8000/competitions/draft", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(buildPayload()),
                });
                const data = await r.json();
                if (!r.ok) throw new Error(formatApiError(data, `HTTP ${r.status}`));
                const id = data.id || data.competition_id;
                if (id) {
                    setSavedCompetitionId(id);
                } else {
                    setDraftError("Draft saved but no ID returned.");
                    console.error("Draft response missing id:", data);
                }
            } catch (err) {
                console.error("Draft save failed:", err);
                setDraftError(err.message || "Failed to save draft.");
            } finally {
                setSavingDraft(false);
            }
        }

        saveDraftAuto();
    }, [currentStep, draftAttempt]); // eslint-disable-line react-hooks/exhaustive-deps

    const clearFieldError = (field) => {
        setErrors((prev) => {
            const copy = { ...prev };
            delete copy[field];
            return copy;
        });
    };

    const updateField = (field, value) => {
        setForm((prev) => {
            const next = { ...prev, [field]: value };
            return next;
        });
        clearFieldError(field);
    };

    // ── Registry: asset types, task types and their option schemas ────────────
    const [registry, setRegistry] = useState(null);
    const [registryError, setRegistryError] = useState("");
    const seededAssets = useRef(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const token = await getFreshToken();
                if (!token) return;
                const res = await fetch("http://127.0.0.1:8000/competition-schema", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || "Could not load asset and task types");
                if (!cancelled) setRegistry(data);
            } catch (e) {
                if (!cancelled) setRegistryError(e.message || "Could not load asset and task types");
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // New competitions start with one Text asset so the step is never empty.
    useEffect(() => {
        if (!registry || isEditMode || seededAssets.current) return;
        seededAssets.current = true;
        setForm((prev) => {
            if (prev.assets.length) return prev;
            const spec = registry.asset_types.find((a) => a.value === "TEXT") || registry.asset_types[0];
            if (!spec) return prev;
            return { ...prev, assets: [{
                id: "text_1", key: "text_1", name: spec.label, type: spec.value,
                required: true, constraints: defaultsFromFields(spec.fields),
            }] };
        });
    }, [registry, isEditMode]);

    const assetSpec = (type) => registry?.asset_types.find((a) => a.value === type);
    const taskSpec = (type) => registry?.task_types.find((t) => t.value === type);

    // Everything a task of this type may legally target, given the current
    // assets and the other tasks. Invalid choices (wrong kind of data, or ones
    // that would create a circular dependency) are simply not offered.
    const targetOptionsFor = (task, taskType = task.type, tasks = form.tasks, assets = form.assets) => {
        const spec = taskSpec(taskType);
        if (!spec) return [];
        const accepts = spec.accepts;
        const opts = [];
        assets.forEach((a) => {
            const kind = assetSpec(a.type)?.kind;
            if (accepts.includes(kind)) opts.push({ value: `ASSET:${a.key}`, label: `Asset · ${a.name || a.key}` });
        });
        if (accepts.includes("sample")) opts.push({ value: "SAMPLE:", label: "Whole sample" });
        tasks.forEach((o) => {
            if (o.key === task.key) return;
            const produces = taskSpec(o.type)?.produces;
            if (accepts.includes(produces) && !dependsTransitively(tasks, o.key, task.key))
                opts.push({ value: `TASK_OUTPUT:${o.key}`, label: `Output of · ${o.name || o.key}` });
        });
        return opts;
    };

    const uniqueName = (base, names) => {
        let name = base, n = 2;
        while (names.some((x) => (x || "").trim().toLowerCase() === name.toLowerCase())) name = `${base} ${n++}`;
        return name;
    };

    // ── Asset handlers ────────────────────────────────────────────────────────
    const addAsset = (type) => {
        const spec = assetSpec(type);
        if (!spec) return;
        setForm((prev) => {
            const key = nextKey(type.toLowerCase(), prev.assets.map((a) => a.key));
            return { ...prev, assets: [...prev.assets, {
                id: key, key, name: uniqueName(spec.label, prev.assets.map((a) => a.name)),
                type, required: true, constraints: defaultsFromFields(spec.fields),
            }] };
        });
        clearFieldError("assets");
    };

    const updateAsset = (id, patch) => {
        setForm((prev) => ({ ...prev, assets: prev.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
        clearFieldError(`asset-${id}`);
    };

    const changeAssetType = (id, type) => {
        const spec = assetSpec(type);
        updateAsset(id, { type, constraints: defaultsFromFields(spec?.fields) });
    };

    const updateAssetConstraint = (id, key, value) => {
        setForm((prev) => ({
            ...prev,
            assets: prev.assets.map((a) => (a.id === id ? { ...a, constraints: { ...a.constraints, [key]: value } } : a)),
        }));
        clearFieldError(`assetField-${id}-${key}`);
    };

    const removeAsset = (id) => {
        setForm((prev) => {
            const gone = prev.assets.find((a) => a.id === id);
            return {
                ...prev,
                assets: prev.assets.filter((a) => a.id !== id),
                // tasks that targeted this asset lose their target and must be re-pointed
                tasks: prev.tasks.map((t) =>
                    t.targetType === "ASSET" && t.targetRef === gone?.key ? { ...t, targetType: "", targetRef: "" } : t
                ),
            };
        });
    };

    // ── Task handlers ─────────────────────────────────────────────────────────
    // The type is picked inside each task card; a new task starts as the first type.
    const addTask = (type = registry?.task_types[0]?.value) => {
        const spec = taskSpec(type);
        if (!spec) return;
        setForm((prev) => {
            const key = nextKey(type.toLowerCase(), prev.tasks.map((t) => t.key));
            const draft = { key, type };
            const first = targetOptionsFor(draft, type, prev.tasks, prev.assets)[0];
            const [targetType, targetRef] = first ? first.value.split(":") : ["", ""];
            return { ...prev, tasks: [...prev.tasks, {
                id: key, key, name: uniqueName(spec.label, prev.tasks.map((t) => t.name)),
                type, targetType, targetRef, dependsOn: [],
                config: initialTaskConfig(spec), instructions: "",
            }] };
        });
        clearFieldError("tasks");
    };

    const updateTask = (id, patch) => {
        setForm((prev) => ({ ...prev, tasks: prev.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
        clearFieldError(`task-${id}`);
        clearFieldError(`taskTarget-${id}`);
    };

    const changeTaskType = (id, type) => {
        const spec = taskSpec(type);
        setForm((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) => {
                if (t.id !== id) return t;
                const stillValid = targetOptionsFor(t, type, prev.tasks, prev.assets)
                    .some((o) => o.value === `${t.targetType}:${t.targetRef || ""}`);
                return {
                    ...t, type, config: initialTaskConfig(spec),
                    ...(stillValid ? {} : { targetType: "", targetRef: "" }),
                };
            }),
        }));
    };

    const setTaskTarget = (id, value) => {
        const [targetType, targetRef] = value ? value.split(":") : ["", ""];
        updateTask(id, { targetType, targetRef: targetRef || "" });
    };

    const toggleTaskDependency = (id, depKey) => {
        setForm((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) => {
                if (t.id !== id) return t;
                const has = t.dependsOn.includes(depKey);
                return { ...t, dependsOn: has ? t.dependsOn.filter((d) => d !== depKey) : [...t.dependsOn, depKey] };
            }),
        }));
    };

    const updateTaskConfigField = (id, key, value) => {
        setForm((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) => (t.id === id ? { ...t, config: { ...t.config, [key]: value } } : t)),
        }));
        clearFieldError(`taskField-${id}-${key}`);
    };

    const removeTask = (id) => {
        setForm((prev) => {
            const gone = prev.tasks.find((t) => t.id === id);
            return {
                ...prev,
                tasks: prev.tasks
                    .filter((t) => t.id !== id)
                    .map((t) => ({
                        ...t,
                        dependsOn: t.dependsOn.filter((d) => d !== gone?.key),
                        ...(t.targetType === "TASK_OUTPUT" && t.targetRef === gone?.key
                            ? { targetType: "", targetRef: "" } : {}),
                    })),
            };
        });
    };

    const updateDataCollection = (field, value) => {
        setForm((prev) => ({
            ...prev,
            dataCollection: { ...prev.dataCollection, [field]: value },
        }));
    };

    const toggleSourceType = (value) => {
        const sources = form.dataCollection.allowedSourceTypes || [];
        updateDataCollection(
            "allowedSourceTypes",
            sources.includes(value) ? sources.filter((s) => s !== value) : [...sources, value]
        );
    };

    // ── Tracks (fair comparison groups, e.g. regional dialect tracks) ──────────
    const addTrack = () => {
        setForm((prev) => ({
            ...prev,
            tracks: [...prev.tracks, { id: Date.now(), name: "", minTeams: 5, description: "" }],
        }));
    };

    const updateTrack = (id, field, value) => {
        setForm((prev) => ({
            ...prev,
            tracks: prev.tracks.map((t) => (t.id === id ? { ...t, [field]: value } : t)),
        }));
    };

    const removeTrack = (id) => {
        setForm((prev) => ({ ...prev, tracks: prev.tracks.filter((t) => t.id !== id) }));
    };

    // ── Phases (ordered competition stages) ─────────────────────────────────────
    const addPhase = () => {
        setForm((prev) => ({
            ...prev,
            phases: [...prev.phases, { id: Date.now(), name: "", durationDays: 7, description: "", allowedPages: ["documentation"] }],
        }));
    };

    const updatePhase = (id, field, value) => {
        setForm((prev) => ({
            ...prev,
            phases: prev.phases.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
        }));
    };

    const togglePhasePage = (id, pageKey) => {
        setForm((prev) => ({
            ...prev,
            phases: prev.phases.map((p) => {
                if (p.id !== id) return p;
                const cur = p.allowedPages || [];
                return { ...p, allowedPages: cur.includes(pageKey) ? cur.filter((k) => k !== pageKey) : [...cur, pageKey] };
            }),
        }));
    };

    const setPhasePages = (id, pages) => {
        setForm((prev) => ({ ...prev, phases: prev.phases.map((p) => (p.id === id ? { ...p, allowedPages: pages } : p)) }));
    };

    const removePhase = (id) => {
        setForm((prev) => ({ ...prev, phases: prev.phases.filter((p) => p.id !== id) }));
    };

    const movePhase = (id, direction) => {
        setForm((prev) => {
            const index = prev.phases.findIndex((p) => p.id === id);
            const swapWith = index + direction;
            if (index < 0 || swapWith < 0 || swapWith >= prev.phases.length) return prev;
            const phases = [...prev.phases];
            [phases[index], phases[swapWith]] = [phases[swapWith], phases[index]];
            return { ...prev, phases };
        });
    };

    const updateLicense = (field, value) => {
        setForm((prev) => ({ ...prev, license: { ...prev.license, [field]: value } }));
    };

    const toggleSkill = (skill) => {
        setForm((prev) => {
            const exists = prev.requiredSkills.includes(skill);
            return {
                ...prev,
                requiredSkills: exists
                    ? prev.requiredSkills.filter((item) => item !== skill)
                    : [...prev.requiredSkills, skill],
                teamSkillMembers: exists
                    ? Object.fromEntries(Object.entries(prev.teamSkillMembers).filter(([k]) => k !== skill))
                    : prev.teamSkillMembers,
            };
        });
    };

    const validateStep = (step = currentStep) => {
        const nextErrors = {};
        const key = wizardSteps[step]?.key;

        if (key === "basic") {
            if (!form.competitionName.trim())
                nextErrors.competitionName = "Competition name is required.";
            if (!form.description.trim())
                nextErrors.description = "Description is required.";
            if (form.startDate && form.endDate && new Date(form.endDate) < new Date(form.startDate))
                nextErrors.endDate = "End date must be after start date.";
            if (form.prizePool !== "" && Number(form.prizePool) < 0)
                nextErrors.prizePool = "Prize pool cannot be negative.";
        }

        // Sample Assets — at least one; unique names; constraints valid per type.
        if (key === "assets") {
            if (!registry) {
                nextErrors.assets = registryError || "Asset types are still loading — try again in a moment.";
            } else {
                if (!form.assets.length) nextErrors.assets = "Add at least one asset to the sample.";
                const seen = new Set();
                form.assets.forEach((a) => {
                    const name = (a.name || "").trim();
                    if (!name) nextErrors[`asset-${a.id}`] = "Every asset needs a name.";
                    else if (seen.has(name.toLowerCase())) nextErrors[`asset-${a.id}`] = `Another asset is already called "${name}".`;
                    seen.add(name.toLowerCase());
                    validateFieldValues(assetSpec(a.type)?.fields || [], a.constraints, `assetField-${a.id}`, nextErrors, name || "Asset");
                    const c = a.constraints || {};
                    if (c.min_words !== undefined && c.max_words !== undefined && c.min_words !== "" && c.max_words !== "" && Number(c.min_words) > Number(c.max_words))
                        nextErrors[`assetField-${a.id}-min_words`] = "Minimum words cannot exceed maximum words.";
                    if (c.min_duration_seconds !== undefined && c.max_duration_seconds !== undefined && c.min_duration_seconds !== "" && c.max_duration_seconds !== "" && Number(c.min_duration_seconds) > Number(c.max_duration_seconds))
                        nextErrors[`assetField-${a.id}-min_duration_seconds`] = "Minimum duration cannot exceed maximum duration.";
                });
            }
        }

        // Tasks — each has a valid target, valid config, and no circular dependency.
        if (key === "tasks") {
            if (!registry) {
                nextErrors.tasks = registryError || "Task types are still loading — try again in a moment.";
            } else {
                if (!form.tasks.length) nextErrors.tasks = "Add at least one task.";
                const seen = new Set();
                form.tasks.forEach((t) => {
                    const name = (t.name || "").trim();
                    if (!name) nextErrors[`task-${t.id}`] = "Every task needs a name.";
                    else if (seen.has(name.toLowerCase())) nextErrors[`task-${t.id}`] = `Another task is already called "${name}".`;
                    seen.add(name.toLowerCase());

                    const valid = targetOptionsFor(t).some((o) => o.value === `${t.targetType}:${t.targetRef || ""}`);
                    if (!t.targetType) nextErrors[`taskTarget-${t.id}`] = "Choose what this task applies to.";
                    else if (!valid) nextErrors[`taskTarget-${t.id}`] = "This target no longer exists or is not compatible with this task type.";

                    validateFieldValues(taskSpec(t.type)?.fields || [], t.config, `taskField-${t.id}`, nextErrors, name || "Task");
                    const c = t.config || {};
                    if (c.multi_label && c.min_labels !== undefined && c.max_labels !== undefined && c.min_labels !== "" && c.max_labels !== "" && Number(c.min_labels) > Number(c.max_labels))
                        nextErrors[`taskField-${t.id}-min_labels`] = "Minimum labels cannot exceed maximum labels.";
                    if (c.min_words !== undefined && c.max_words !== undefined && c.min_words !== "" && c.max_words !== "" && Number(c.min_words) > Number(c.max_words))
                        nextErrors[`taskField-${t.id}-min_words`] = "Minimum words cannot exceed maximum words.";
                });
                const cycle = findTaskCycle(form.tasks);
                if (cycle) {
                    const nameOf = (k) => form.tasks.find((t) => t.key === k)?.name || k;
                    nextErrors.tasks = `Circular task dependency: ${cycle.map(nameOf).join(" → ")}`;
                }
            }
        }

        // Data Collection — a contributed instance is a sample, so its inputs
        // are the Sample Assets (nothing to validate for them here).
        if (key === "dataCollection") {
            const dc = form.dataCollection;
            if (!Array.isArray(dc.allowedSourceTypes) || !dc.allowedSourceTypes.length)
                nextErrors.allowedSourceTypes = "Select at least one allowed data source.";
            const annotators = Number(dc.annotatorsPerInstance);
            if (!Number.isInteger(annotators) || annotators < 1)
                nextErrors.annotatorsPerInstance = "Enter a whole number, at least 1.";
            else if (annotators > MAX_ANNOTATORS)
                nextErrors.annotatorsPerInstance = `At most ${MAX_ANNOTATORS} annotators per instance.`;
            else if (annotators > smallestTeam(form.minMembers))
                nextErrors.annotatorsPerInstance = annotatorLimitMessage(annotators, form.minMembers);
        }

        if (key === "tracks") {
            if (!form.tracks.length)
                nextErrors.tracks = "Add at least one track, or turn off Tracks in Basic Info.";
            const seenTracks = new Set();
            form.tracks.forEach((t) => {
                const name = t.name.trim();
                if (!name) nextErrors[`trackName-${t.id}`] = "Track name is required.";
                else if (seenTracks.has(name.toLowerCase()))
                    nextErrors[`trackName-${t.id}`] = `Another track is already called "${name}".`;
                seenTracks.add(name.toLowerCase());
                if (!t.minTeams || Number(t.minTeams) < 1)
                    nextErrors[`trackMin-${t.id}`] = "Minimum teams must be at least 1.";
            });
            // every team belongs to exactly one track, so the minimums must fit inside the team cap
            const teamCap = Number(form.maxTeams);
            const teamsNeeded = form.tracks.reduce((sum, t) => sum + (Number(t.minTeams) || 0), 0);
            if (teamCap > 0 && teamsNeeded > teamCap && !nextErrors.tracks)
                nextErrors.tracks = `The tracks need at least ${teamsNeeded} teams in total, but the competition is limited to ${teamCap} teams (Rules step).`;
        }

        if (key === "phases") {
            if (form.phases.length < 1)
                nextErrors.phases = "Add at least one phase.";
            form.phases.forEach((p) => {
                if (!p.name.trim())
                    nextErrors[`phaseName-${p.id}`] = "Phase name is required.";
                if (!(p.description || "").trim())
                    nextErrors[`phaseDesc-${p.id}`] = "Add a short description — members see it when they open a locked page.";
                if (!p.durationDays || Number(p.durationDays) <= 0)
                    nextErrors[`phaseDuration-${p.id}`] = "Duration must be greater than 0 days.";
            });
            // the phases have to fit inside the start/end window the rest of the platform uses
            if (form.startDate && form.endDate && !nextErrors.phases) {
                const phaseDays = form.phases.reduce((s, ph) => s + (Number(ph.durationDays) || 0), 0);
                const windowDays = Math.round((new Date(form.endDate) - new Date(form.startDate)) / 86400000) + 1;
                if (phaseDays > windowDays)
                    nextErrors.phases = `The phases add up to ${phaseDays} days, but the competition only runs ${windowDays} days (${form.startDate} → ${form.endDate}). Shorten the phases or move the end date.`;
            }
        }

        if (key === "license") {
            if (!form.license.version.trim())
                nextErrors.licenseVersion = "License version is required.";
            if (!form.license.text.trim())
                nextErrors.licenseText = "License text is required so participants can accept it before contributing data.";
        }

        if (key === "evaluation") {
            if (!form.primaryMetric)
                nextErrors.primaryMetric = "Primary metric is required.";
            if (form.secondaryMetric && form.secondaryMetric === form.primaryMetric)
                nextErrors.secondaryMetric = "The tie-breaker must be a different metric from the primary one.";
            if (form.participantSourcedData && form.evaluationMode === "data_quality_plus_model") {
                const total = Number(form.dataQualityWeight) + Number(form.modelWeight);
                if (total !== 100)
                    nextErrors.weightSplit = `Data quality + model weights must add up to 100 (currently ${total}).`;
                if (form.publicTestFraction !== "" && (Number(form.publicTestFraction) < 0 || Number(form.publicTestFraction) > 100))
                    nextErrors.publicTestFraction = "Held-out test fraction must be between 0 and 100.";
                if (!form.winnersPerTrack || Number(form.winnersPerTrack) < 1)
                    nextErrors.winnersPerTrack = form.tracksEnabled
                        ? "At least 1 winner per track is required."
                        : "At least 1 winner is required.";
            }
        }

        if (key === "rules") {
            if (form.maxTeams !== "" && Number(form.maxTeams) < 0)
                nextErrors.maxTeams = "Maximum teams cannot be negative.";
            if (form.minMembers !== "" && Number(form.minMembers) <= 0)
                nextErrors.minMembers = "Minimum members must be greater than 0.";
            if (form.maxMembers !== "" && Number(form.maxMembers) <= 0)
                nextErrors.maxMembers = "Maximum members must be greater than 0.";
            if (form.maxMembers !== "") {
                const tooMany = form.requiredSkills
                    .filter((skill) => {
                        const rule = form.teamSkillMembers[skill];
                        return rule !== "all" && Number(rule) > Number(form.maxMembers);
                    })
                    .map((skill) => `"${skill}" is required on ${form.teamSkillMembers[skill]} members`);
                if (tooMany.length)
                    nextErrors.teamSkillMembers = `${tooMany.join("; ")}, but teams have at most ${form.maxMembers}.`;
            }
            if (form.minMembers !== "" && form.maxMembers !== "" && Number(form.minMembers) > Number(form.maxMembers))
                nextErrors.maxMembers = "Max members cannot be less than min members.";
            // the Data Collection step caps annotators by the smallest team, so a later change here must respect it
            if (form.participantSourcedData) {
                const annotators = Number(form.dataCollection?.annotatorsPerInstance);
                if (Number.isInteger(annotators) && annotators > smallestTeam(form.minMembers))
                    nextErrors.minMembers = annotatorLimitMessage(annotators, form.minMembers);
            }
            if (form.maxSubmissionsPerDay !== "" && Number(form.maxSubmissionsPerDay) <= 0)
                nextErrors.maxSubmissionsPerDay = "Max submissions per day must be greater than 0.";
            if (form.mergeDeadline && form.startDate && new Date(form.mergeDeadline) < new Date(form.startDate))
                nextErrors.mergeDeadline = "Merge deadline cannot be before start date.";
            if (form.mergeDeadline && form.endDate && new Date(form.mergeDeadline) > new Date(form.endDate))
                nextErrors.mergeDeadline = "Merge deadline cannot be after end date.";
        }

        if (key === "evaluation" && !form.phasesEnabled) {
            if (form.validationDate && form.startDate && new Date(form.validationDate) < new Date(form.startDate))
                nextErrors.validationDate = "Validation date cannot be before start date.";
            if (form.validationDate && form.endDate && new Date(form.validationDate) > new Date(form.endDate))
                nextErrors.validationDate = "Validation date cannot be after competition end date.";
            if (form.freezeDate && form.startDate && new Date(form.freezeDate) < new Date(form.startDate))
                nextErrors.freezeDate = "Freeze date cannot be before start date.";
            if (form.freezeDate && form.validationDate && new Date(form.freezeDate) < new Date(form.validationDate))
                nextErrors.freezeDate = "Freeze date cannot be before validation date.";
            if (form.freezeDate && form.endDate && new Date(form.freezeDate) > new Date(form.endDate))
                nextErrors.freezeDate = "Freeze date cannot be after competition end date.";
        }

        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) {
            stepHeading.current?.focus({ preventScroll: true });
            stepHeading.current?.scrollIntoView({ block: "start" });
        }
        return Object.keys(nextErrors).length === 0;
    };

    const buildPayload = () => {
        const taskConfig = {};
        const promptLines = listFromValue(form.prompts);
        // In edit mode an empty list is sent too (so clearing the box really removes the prompts),
        // but only after the stored prompts were loaded - otherwise a failed load would wipe them.
        if (promptLines.length || (isEditMode && promptsLoaded)) taskConfig.prompts = promptLines;

        // Team eligibility: how many members must hold each required skill (only non-default rules are stored).
        const skillMembers = {};
        form.requiredSkills.forEach((skill) => {
            const rule = form.teamSkillMembers[skill];
            if (rule === "all" || (Number(rule) > 1)) skillMembers[skill] = rule === "all" ? "all" : Number(rule);
        });
        if (Object.keys(skillMembers).length) taskConfig.team_requirements = { skill_members: skillMembers };

        // Each capability rides as its own flat key inside task_config (which
        // is stored as the competition's dataset_config JSON) — independent of
        // each other. (Assets and tasks are sent separately, below.)
        if (form.tracksEnabled) {
            taskConfig.tracks_enabled = true;
            taskConfig.tracks = form.tracks.map((t) => ({
                id: t.id, name: t.name.trim(), minTeams: Number(t.minTeams) || 1,
                description: (t.description || "").trim(),
                // keep the outcome of "finalize tracks" when the competition is re-saved,
                // otherwise a dropped track would silently come back
                ...(t.active !== undefined ? { active: t.active } : {}),
                ...(t.team_count !== undefined ? { team_count: t.team_count } : {}),
            }));
        }

        if (form.phasesEnabled) {
            taskConfig.phases_enabled = true;
            taskConfig.phases = form.phases.map((p, i) => ({
                id: p.id,
                order: i + 1,
                name: p.name.trim(),
                durationDays: Number(p.durationDays) || 1,
                description: (p.description || "").trim(),
                // page keys members may open during this phase; everything else shows as locked
                allowedPages: (p.allowedPages || []).filter((k) => ALL_PHASE_PAGE_KEYS.includes(k)),
            }));
        }

        if (form.participantSourcedData) {
            const hasExternalSource = (form.dataCollection.allowedSourceTypes || []).some((s) => s !== "self_recorded");
            taskConfig.data_collection_enabled = true;
            taskConfig.data_collection = {
                allowed_source_types: form.dataCollection.allowedSourceTypes,
                // a source link only makes sense when some data does not come from the contributor
                require_public_source_provenance: !!form.dataCollection.requireProvenance && hasExternalSource,
                annotators_per_instance: Number(form.dataCollection.annotatorsPerInstance) || 1,
                adjudication_enabled: !!form.dataCollection.adjudicationEnabled,
            };
            taskConfig.license = {
                version: form.license.version.trim(),
                text: form.license.text,
            };
        }

        // Evaluation scoring mode always rides along; "standard" is a no-op.
        // Combined scoring only exists with Data Collection; a leftover choice from before the
        // organizer switched Data Collection off must not be saved.
        const evalMode = form.participantSourcedData ? form.evaluationMode : "standard";
        const combined = evalMode === "data_quality_plus_model";
        taskConfig.evaluation_scoring = {
            mode: evalMode,
            data_quality_weight: combined ? Number(form.dataQualityWeight) : null,
            model_weight: combined ? Number(form.modelWeight) : null,
            per_team_baseline_enabled: combined ? !!form.perTeamBaselineEnabled : false,
            public_test_fraction: combined ? Number(form.publicTestFraction) : null,
            winners_per_track: combined ? Number(form.winnersPerTrack) : null,
        };

        return {
            competition_name: form.competitionName,
            // No competition type: a competition is its assets + tasks.
            assets: form.assets.map((a) => ({
                key: a.key,
                name: a.name.trim(),
                type: a.type,
                required: a.required,
                constraints: serializeFieldValues(assetSpec(a.type)?.fields || [], a.constraints),
            })),
            tasks: form.tasks.map((t) => ({
                key: t.key,
                name: t.name.trim(),
                type: t.type,
                target: { type: t.targetType, ref: t.targetType === "SAMPLE" ? null : (t.targetRef || null) },
                config: serializeFieldValues(taskSpec(t.type)?.fields || [], t.config),
                depends_on: t.dependsOn,
                instructions: t.instructions.trim() || null,
            })),
            description: form.description,
            start_date: form.startDate || null,
            end_date: form.endDate || null,
            prize_pool: form.prizePool === "" ? null : Number(form.prizePool),

            primary_metric: form.primaryMetric || null,
            secondary_metric: form.secondaryMetric || null,

            max_teams: form.maxTeams === "" ? null : Number(form.maxTeams),
            min_members: form.minMembers === "" ? null : Number(form.minMembers),
            max_members: form.maxMembers === "" ? null : Number(form.maxMembers),
            merge_deadline: form.mergeDeadline || null,
            required_skills: form.requiredSkills,
            max_submissions_per_day: form.maxSubmissionsPerDay === "" ? null : Number(form.maxSubmissionsPerDay),
            allow_external_data: form.allowExternalData,
            allow_pretrained_models: form.allowPretrainedModels,
            require_code_sharing: form.requireCodeSharing,
            additional_rules: form.additionalRules || null,

            complexity_level: form.complexityLevel,

            // Phases, when enabled, drives the timeline. Otherwise these two
            // plain cutoff dates (set in the Evaluation step) are the only
            // extra timeline info the competition carries.
            validation_date: form.phasesEnabled ? null : (form.validationDate || null),
            freeze_date: form.phasesEnabled ? null : (form.freezeDate || null),

            // Whichever independent
            // capabilities (tracks / phases / data collection) are turned on.
            task_config: taskConfig,
            join_method: form.joinMethod || "auto",
            tracks_enabled: form.tracksEnabled,
            phases_enabled: form.phasesEnabled,
            data_collection_enabled: form.participantSourcedData,
        };
    };

    const saveDraft = async () => {
        if (isEditMode) return;

        try {
            setSubmitting(true);
            const token = await getFreshToken();
            if (!token) { notify.error("Please sign in first", "Your session has expired."); navigate("/login"); return; }

            const res = await fetch("http://127.0.0.1:8000/competitions/draft", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(buildPayload()),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(formatApiError(data, `Request failed (HTTP ${res.status})`));

            const id = data.id || data.competition_id;
            if (id) setSavedCompetitionId(id);

            notify.success("Draft saved", "Your progress has been saved as a draft.");
        } catch (error) {
            console.error(error);
            notify.error("Could not save the competition", error.message);
        } finally {
            setSubmitting(false);
        }
    };

    const submitCompetition = async () => {
        for (let step = 0; step < wizardSteps.length; step++) {
            if (!validateStep(step)) {
                setCurrentStep(step);
                return;
            }
        }

        try {
            setSubmitting(true);
            const token = await getFreshToken();
            if (!token) { notify.error("Please sign in first", "Your session has expired."); navigate("/login"); return; }

            const url = isEditMode
                ? `http://127.0.0.1:8000/competitions/${competitionId}/update`
                : savedCompetitionId
                    ? `http://127.0.0.1:8000/competitions/${savedCompetitionId}/update`
                    : "http://127.0.0.1:8000/competitions/create";

            const method = isEditMode || savedCompetitionId ? "PUT" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(buildPayload()),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(formatApiError(data, `Request failed (HTTP ${res.status})`));

            notify.success(isEditMode ? "Competition updated" : "Competition created", form.competitionName.trim());

            if (isEditMode) {
                navigate(`/competitions/${competitionId}/organizer`, { state: { refreshed: true } });
            } else {
                navigate("/competitions", { state: { refreshAll: true } });
            }
        } catch (error) {
            console.error(error);
            notify.error("Could not save the competition", error.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = () => {
        if (isEditMode) navigate(`/competitions/${competitionId}/organizer`);
        else navigate("/competitions");
    };

    const handleNext = () => {
        if (!validateStep(currentStep)) return;
        if (currentStep < wizardSteps.length - 1) setCurrentStep((prev) => prev + 1);
    };

    const handlePrevious = () => {
        if (currentStep > 0) setCurrentStep((prev) => prev - 1);
    };

    const ErrorMessage = ({ name }) => {
        useInterfaceLanguage();
        if (!errors[name]) return null;
        return <span className="field-error">{__msg(errors[name])}</span>;
    };

    // ── Render helpers ─────────────────────────────────────────────────────────

    const renderBasicInfo = () => (
        <div className="create-card">
            <div className="create-section">
                <label>{__msg("Competition Name")}{" "}<span className="required-star">*</span></label>
                <input
                    className={errors.competitionName ? "input-error" : ""}
                    type="text"
                    placeholder={__msg("e.g., Semantic Drift v4.2")}
                    aria-label={__msg("Competition name")} value={form.competitionName}
                    onChange={(e) => updateField("competitionName", e.target.value)}
                />
                <ErrorMessage name="competitionName" />
            </div>

            <div className="create-section">
                <label>{__msg("Description")}{" "}<span className="required-star">*</span></label>
                <textarea
                    className={errors.description ? "input-error" : ""}
                    rows="3"
                    placeholder={__msg("Describe the competition goal, task, and expected output...")}
                    aria-label={__msg("Description")} value={form.description}
                    onChange={(e) => updateField("description", e.target.value)}
                />
                <ErrorMessage name="description" />
            </div>

            <div className="create-two-col">
                <div className="create-section">
                    <label>{__msg("Start Date")}</label>
                    <input
                        className={errors.startDate ? "input-error" : ""}
                        type="date"
                        aria-label={__msg("Start date")} value={form.startDate}
                        onChange={(e) => updateField("startDate", e.target.value)}
                    />
                    <ErrorMessage name="startDate" />
                </div>

                <div className="create-section">
                    <label>{__msg("End Date")}</label>
                    <input
                        className={errors.endDate ? "input-error" : ""}
                        type="date"
                        aria-label={__msg("End date")} value={form.endDate}
                        onChange={(e) => updateField("endDate", e.target.value)}
                    />
                    <ErrorMessage name="endDate" />
                </div>
            </div>

            <div className="create-section">
                <label>{__msg("Prize Pool (USD)")}</label>
                <input
                    className={errors.prizePool ? "input-error" : ""}
                    type="number"
                    placeholder="e.g., 12500"
                    aria-label={__msg("Prize pool in USD")} value={form.prizePool}
                    onChange={(e) => updateField("prizePool", e.target.value)}
                />
                <small>{__msg("Optional. Leave empty if there is no prize.")}</small>
                <ErrorMessage name="prizePool" />
            </div>

            <div className="section-header-row">
                <div>
                    <h4 style={{ margin: 0 }}>{__msg("Platform Capabilities")}</h4>
                    <p className="create-card-subtitle" style={{ margin: 0 }}>{" "}{__msg("Turn on whichever of these this competition needs. Each is independent — use any combination.")}{" "}</p>
                </div>
            </div>

            <div className="toggle-row">
                <div>
                    <strong>{__msg("Tracks")}</strong>
                    <p>{" "}{__msg("Split participants into separate comparison groups (region, language, category...), each with its own minimum team count to be viable.")}{" "}</p>
                </div>
                <label className="switch">
                    <input
                        type="checkbox"
                        aria-label={__msg("Enable tracks")} checked={form.tracksEnabled}
                        onChange={(e) => updateField("tracksEnabled", e.target.checked)}
                    />
                    <span className="slider"></span>
                </label>
            </div>

            <div className="toggle-row">
                <div>
                    <strong>{__msg("Phases")}</strong>
                    <p>{" "}{__msg("Split the competition window into ordered, named stages (e.g. Data Collection → Training → Leaderboard). Their total length must fit between the start and end dates, and they replace the validation / freeze cutoffs.")}{" "}</p>
                </div>
                <label className="switch">
                    <input
                        type="checkbox"
                        aria-label={__msg("Enable phases")} checked={form.phasesEnabled}
                        onChange={(e) => updateField("phasesEnabled", e.target.checked)}
                    />
                    <span className="slider"></span>
                </label>
            </div>

            <div className="toggle-row">
                <div>
                    <strong>{__msg("Data Collection")}</strong>
                    <p>{" "}{__msg("Participants source, record, or adapt their own raw data instead of using a dataset you provide. Adds format limits, allowed sources, the annotation protocol, and a mandatory data usage license. You won't need to upload a dataset — the data collected from participants is what gets used for training and evaluation.")}{" "}</p>
                </div>
                <label className="switch">
                    <input
                        type="checkbox"
                        aria-label={__msg("Enable participant data collection")} checked={form.participantSourcedData}
                        onChange={(e) => updateField("participantSourcedData", e.target.checked)}
                    />
                    <span className="slider"></span>
                </label>
            </div>
        </div>
    );

    // ── Generic option form, driven by the registry's field specs ──────────────
    const renderFields = (fields, values, onChange, errKey) => (
        <div className="create-two-col">
            {fields.filter((f) => isFieldVisible(f, fields, values)).map((f) => {
                const v = values?.[f.key];
                const errName = `${errKey}-${f.key}`;
                const wide = f.type === "string_list" || f.type === "multi_select" || f.type === "text";
                const label = <label>{__msg(f.label)}{f.required && <span className="required-star"> *</span>}</label>;
                let control;
                if (f.type === "boolean") {
                    control = (
                        <label className="switch">
                            <input type="checkbox" checked={!!v} onChange={(e) => onChange(f.key, e.target.checked)} />
                            <span className="slider"></span>
                        </label>
                    );
                } else if (f.type === "select") {
                    control = (
                        <select value={v ?? ""} onChange={(e) => onChange(f.key, e.target.value)}>
                            {f.options.map((o) => <option key={o} value={o}>{__msg(o)}</option>)}
                        </select>
                    );
                } else if (f.type === "multi_select") {
                    const cur = Array.isArray(v) ? v : [];
                    control = (
                        <div className="tc-radio-group">
                            {f.options.map((o) => {
                                const on = cur.includes(o);
                                return (
                                    <label key={o} className={`tc-radio-option ${on ? "selected" : ""}`}>
                                        <input type="checkbox" checked={on}
                                            onChange={() => onChange(f.key, on ? cur.filter((x) => x !== o) : [...cur, o])} />
                                        <div><strong>{__msg(o)}</strong></div>
                                    </label>
                                );
                            })}
                        </div>
                    );
                } else if (f.type === "string_list" || f.type === "text") {
                    control = (
                        <textarea
                            rows={4}
                            className={errors[errName] ? "input-error" : ""}
                            placeholder={__msg(f.help || "")}
                            value={Array.isArray(v) ? v.join("\n") : (v ?? "")}
                            onChange={(e) => onChange(f.key, e.target.value)}
                        />
                    );
                } else if (f.type === "integer" || f.type === "number") {
                    control = (
                        <input type="number" className={errors[errName] ? "input-error" : ""}
                            min={f.min} max={f.max} step={f.type === "integer" ? 1 : "any"}
                            placeholder={__msg(f.placeholder || "")} value={v ?? ""}
                            onChange={(e) => onChange(f.key, e.target.value)} />
                    );
                } else {
                    control = (
                        <input type="text" className={errors[errName] ? "input-error" : ""}
                            placeholder={__msg(f.placeholder || "")} value={v ?? ""}
                            onChange={(e) => onChange(f.key, e.target.value)} />
                    );
                }
                return (
                    <div key={f.key} className="create-section" style={wide ? { gridColumn: "1 / -1" } : undefined}>
                        {__msg(label)}
                        {control}
                        {f.help && f.type !== "string_list" && f.type !== "text" && (
                            <p className="create-card-subtitle" style={{ margin: "4px 0 0" }}>{__msg(f.help)}</p>
                        )}
                        <ErrorMessage name={errName} />
                    </div>
                );
            })}
        </div>
    );

    const monoBox = {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13,
        whiteSpace: "pre", padding: "10px 14px", borderRadius: 8,
        background: "rgba(127,127,127,0.10)", overflowX: "auto", margin: "0 0 16px",
    };

    // ── Sample Assets step ────────────────────────────────────────────────────
    const renderAssets = () => {
        if (!registry) {
            return (
                <div className="create-card">
                    <p className="create-card-subtitle">{registryError || __msg("Loading asset types…")}</p>
                    <ErrorMessage name="assets" />
                </div>
            );
        }
        const tree = form.assets.length
            ? "Sample\n" + form.assets.map((a, i) => `${i === form.assets.length - 1 ? "└──" : "├──"} ${a.name || "(unnamed)"}  [${a.type}]`).join("\n")
            : "Sample\n(no assets yet)";

        return (
            <div className="create-card">
                <div className="section-header-row">
                    <div>
                        <h3 className="create-card-title" style={{ margin: 0 }}>{__msg("Sample Assets")}</h3>
                        <p className="create-card-subtitle" style={{ margin: 0 }}>{" "}{__msg("Define what one sample is made of. A sample has one or more assets — add any number and combination (e.g. two audio clips and a text). Each asset has its own constraints.")}{" "}</p>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {registry.asset_types.map((t) => (
                            <button key={t.value} type="button" className="soft-action-btn" onClick={() => addAsset(t.value)}>
                                + {__msg(t.label)}
                            </button>
                        ))}
                    </div>
                </div>

                {form.legacyTaskType && (
                    <p className="create-card-subtitle" style={{ marginTop: 12 }}>{" "}{__msg("This competition was created with the old \"")}{form.legacyTaskType}{__msg("\" type, which no longer exists. Define its assets and tasks here to move it to the new model.")}{" "}</p>
                )}

                <ErrorMessage name="assets" />
                <pre style={monoBox}>{tree}</pre>

                {form.assets.map((asset, idx) => {
                    const spec = assetSpec(asset.type);
                    return (
                        <div key={asset.id} className="inner-panel">
                            <div className="create-two-col">
                                <div className="create-section">
                                    <label>{__msg("Asset")}{" "}{idx + 1}{" "}{__msg("name")}{" "}<span className="required-star">*</span></label>
                                    <input type="text" className={errors[`asset-${asset.id}`] ? "input-error" : ""}
                                        placeholder={__msg("e.g., Recording")} value={asset.name}
                                        onChange={(e) => updateAsset(asset.id, { name: e.target.value })} />
                                    <ErrorMessage name={`asset-${asset.id}`} />
                                </div>
                                <div className="create-section">
                                    <label>{__msg("Type")}</label>
                                    <select value={asset.type} onChange={(e) => changeAssetType(asset.id, e.target.value)}>
                                        {registry.asset_types.map((t) => <option key={t.value} value={t.value}>{__msg(t.label)}</option>)}
                                    </select>
                                </div>
                            </div>

                            {spec && renderFields(spec.fields, asset.constraints,
                                (k, v) => updateAssetConstraint(asset.id, k, v), `assetField-${asset.id}`)}

                            <div className="toggle-row">
                                <div>
                                    <strong>{__msg("Required")}</strong>
                                    <p>{__msg("Every sample must include this asset.")}</p>
                                </div>
                                <label className="switch">
                                    <input type="checkbox" checked={asset.required}
                                        onChange={(e) => updateAsset(asset.id, { required: e.target.checked })} />
                                    <span className="slider"></span>
                                </label>
                            </div>

                            {form.assets.length > 1 && (
                                <div className="create-section" style={{ justifyContent: "flex-end" }}>
                                    <button type="button" className="remove-btn" onClick={() => removeAsset(asset.id)}>{" "}{__msg("Remove asset")}{" "}</button>
                                </div>
                            )}
                        </div>
                    );
                })}

                <div className="create-section">
                    <label>{__msg("Source prompts (optional)")}</label>
                    <textarea rows={4} placeholder={__msg("One per line — sentences or texts shown to contributors")}
                        value={form.prompts} onChange={(e) => updateField("prompts", e.target.value)} />
                </div>
            </div>
        );
    };

    // ── Tasks step ────────────────────────────────────────────────────────────
    const renderTasks = () => {
        if (!registry) {
            return (
                <div className="create-card">
                    <p className="create-card-subtitle">{registryError || __msg("Loading task types…")}</p>
                    <ErrorMessage name="tasks" />
                </div>
            );
        }
        const labelOf = (t) => {
            if (t.targetType === "ASSET") return form.assets.find((a) => a.key === t.targetRef)?.name || "?";
            if (t.targetType === "TASK_OUTPUT") return `output of ${form.tasks.find((x) => x.key === t.targetRef)?.name || "?"}`;
            if (t.targetType === "SAMPLE") return "whole sample";
            return "?";
        };
        const flow = form.tasks.length
            ? form.tasks.map((t) => `${t.name || t.key}  ←  ${labelOf(t)}`).join("\n")
            : "(no tasks yet)";

        return (
            <div className="create-card">
                <div className="section-header-row">
                    <div>
                        <h3 className="create-card-title" style={{ margin: 0 }}>{__msg("Tasks")}</h3>
                        <p className="create-card-subtitle" style={{ margin: 0 }}>{" "}{__msg("Define what contributors do on a sample. Each task targets one asset, the whole sample, or the output of another task (e.g. Transcription → NER).")}{" "}</p>
                    </div>
                    <button type="button" className="soft-action-btn" onClick={() => addTask()}>{" "}{__msg("+ Add Task")}{" "}</button>
                </div>

                <ErrorMessage name="tasks" />
                <pre style={monoBox}>{flow}</pre>

                {form.tasks.map((task, idx) => {
                    const spec = taskSpec(task.type);
                    const options = targetOptionsFor(task);
                    const depCandidates = form.tasks.filter(
                        (o) => o.key !== task.key && !dependsTransitively(form.tasks, o.key, task.key)
                    );
                    const implicit = task.targetType === "TASK_OUTPUT" ? task.targetRef : null;
                    return (
                        <div key={task.id} className="inner-panel">
                            <div className="create-two-col">
                                <div className="create-section">
                                    <label>{__msg("Task")}{" "}{idx + 1}{" "}{__msg("name")}{" "}<span className="required-star">*</span></label>
                                    <input type="text" className={errors[`task-${task.id}`] ? "input-error" : ""}
                                        value={task.name} onChange={(e) => updateTask(task.id, { name: e.target.value })} />
                                    <ErrorMessage name={`task-${task.id}`} />
                                </div>
                                <div className="create-section">
                                    <label>{__msg("Task type")}</label>
                                    <select value={task.type} onChange={(e) => changeTaskType(task.id, e.target.value)}>
                                        {registry.task_types.map((t) => <option key={t.value} value={t.value}>{__msg(t.label)}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="create-section">
                                <label>{__msg("Applies to")}{" "}<span className="required-star">*</span></label>
                                <select className={errors[`taskTarget-${task.id}`] ? "input-error" : ""}
                                    value={`${task.targetType}:${task.targetRef || ""}`}
                                    onChange={(e) => setTaskTarget(task.id, e.target.value === ":" ? "" : e.target.value)}>
                                    <option value=":">{__msg("Select target…")}</option>
                                    {options.map((o) => <option key={o.value} value={o.value}>{__msg(o.label)}</option>)}
                                </select>
                                <p className="create-card-subtitle" style={{ margin: "4px 0 0" }}>
                                    {__msg(spec?.description)}{" "}{__msg("Accepts:")}{" "}{spec?.accepts.map((a) => __msg(a === "sample" ? "whole sample" : a)).join(", ")}.
                                </p>
                                <ErrorMessage name={`taskTarget-${task.id}`} />
                            </div>

                            {depCandidates.length > 0 && (
                                <div className="create-section">
                                    <label>{__msg("Must wait for (optional)")}</label>
                                    <div className="tc-radio-group">
                                        {depCandidates.map((o) => {
                                            const forced = implicit === o.key;
                                            const on = forced || task.dependsOn.includes(o.key);
                                            return (
                                                <label key={o.key} className={`tc-radio-option ${on ? "selected" : ""}`}
                                                    title={forced ? __msg("Already required because this task uses its output") : ""}>
                                                    <input type="checkbox" checked={on} disabled={forced}
                                                        onChange={() => toggleTaskDependency(task.id, o.key)} />
                                                    <div><strong>{o.name || o.key}</strong></div>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {spec && renderFields(spec.fields, task.config,
                                (k, v) => updateTaskConfigField(task.id, k, v), `taskField-${task.id}`)}

                            <div className="create-section">
                                <label>{__msg("Instructions for contributors (optional)")}</label>
                                <textarea rows={2} value={task.instructions}
                                    onChange={(e) => updateTask(task.id, { instructions: e.target.value })} />
                            </div>

                            <div className="create-section" style={{ justifyContent: "flex-end" }}>
                                <button type="button" className="remove-btn" onClick={() => removeTask(task.id)}>{" "}{__msg("Remove task")}{" "}</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    // Read-only: the inputs of a contributed instance ARE the sample assets.
    const renderInstanceInputsSummary = () => (
        <div className="create-section">
            <h4 style={{ margin: 0 }}>{__msg("Instance Inputs")}</h4>
            <p className="create-card-subtitle" style={{ margin: "4px 0 8px" }}>{" "}{__msg("A contributed instance is a sample, so it carries exactly the Sample Assets you defined. Edit them in the Sample Assets step.")}{" "}</p>
            <pre style={monoBox}>
                {form.assets.length
                    ? form.assets.map((a) => {
                        const c = a.constraints || {};
                        const lim = a.type === "AUDIO" ? `max ${c.max_duration_seconds ?? "?"}s` : `max ${c.max_words ?? "?"} words`;
                        return `${a.name || "(unnamed)"}  ·  ${a.type}  ·  ${lim}`;
                    }).join("\n")
                    : "(no assets defined)"}
            </pre>
        </div>
    );

    // ── Data Collection step ────────────────────────────────────────────────────
    // Turn this on whenever contributors source, record, or adapt their own raw
    // data instead of using an organizer-provided dataset.
    const renderDataCollection = () => {
        const dc = form.dataCollection;
        const R = Number(dc.annotatorsPerInstance);
        const validR = Number.isInteger(R) && R >= 1;
        const canTie = validR && R >= 2;
        const smallestTeamSize = smallestTeam(form.minMembers);
        const overTeamLimit = validR && R > smallestTeamSize;
        const hasExternalSource = (dc.allowedSourceTypes || []).some((s) => s !== "self_recorded");
        const hasAgreementTasks = form.tasks.some((t) => ["labels", "spans"].includes(taskSpec(t.type)?.answer));

        let adjudicationText;
        if (!validR) adjudicationText = "Set the number of annotators first.";
        else if (!canTie) adjudicationText = "Needs at least 2 annotators per instance - a single annotator can't disagree with anyone.";
        else if (dc.adjudicationEnabled)
            adjudicationText = `If the first ${R} annotators end in an exact tie, one extra annotator (the ${ordinal(R + 1)}) is added to break it. If it is still tied, another is added.`;
        else
            adjudicationText = `Off: when the ${R} annotators end in an exact tie, the sample stays flagged as a conflict and is never marked complete.`;

        return (
            <div className="create-card">
                <h3 className="create-card-title">{__msg("Data Collection")}</h3>
                <p className="create-card-subtitle">{" "}{__msg("Contributors source, record, or adapt their own data — these rules keep every submitted instance comparable and, if you plan to publish the resulting dataset, legally sound.")}{" "}</p>

                {renderInstanceInputsSummary()}

                <div className="create-section">
                    <label>{__msg("Allowed Data Sources")}{" "}<span className="required-star">*</span></label>
                    <div className="tc-radio-group">
                        {SOURCE_TYPE_OPTIONS.map((opt) => {
                            const selected = (dc.allowedSourceTypes || []).includes(opt.value);
                            return (
                                <label key={opt.value} className={`tc-radio-option ${selected ? "selected" : ""}`}>
                                    <input type="checkbox" checked={selected} onChange={() => toggleSourceType(opt.value)} />
                                    <div><strong>{__msg(opt.label)}</strong></div>
                                </label>
                            );
                        })}
                    </div>
                    <ErrorMessage name="allowedSourceTypes" />
                </div>

                <div className="toggle-row">
                    <div>
                        <strong>{__msg("Require Public Source Provenance")}</strong>
                        <p>
                            {hasExternalSource
                                ? __msg("Contributors must record a source link/timestamp for anything not self-recorded, so origin can be verified or removed on request.")
                                : __msg("Not applicable: every allowed source is recorded / written by the participant, so there is no outside source to link.")}
                        </p>
                    </div>
                    <label className="switch">
                        <input
                            type="checkbox"
                            checked={!!dc.requireProvenance && hasExternalSource}
                            disabled={!hasExternalSource}
                            onChange={(e) => updateDataCollection("requireProvenance", e.target.checked)}
                        />
                        <span className="slider"></span>
                    </label>
                </div>

                <div className="inner-panel">
                    <h4>{__msg("Annotation Protocol")}</h4>
                    <div className="create-two-col">
                        <div className="create-section">
                            <label>{__msg("Annotators per Instance")}{" "}<span className="required-star">*</span></label>
                            <input
                                className={errors.annotatorsPerInstance ? "input-error" : ""}
                                type="number" min="1" max={Math.min(MAX_ANNOTATORS, smallestTeamSize)} step="1"
                                value={dc.annotatorsPerInstance ?? ""}
                                onChange={(e) => {
                                    updateDataCollection("annotatorsPerInstance", e.target.value);
                                    clearFieldError("annotatorsPerInstance");
                                }}
                            />
                            <small>{" "}{__msg("Different annotators who must independently label each instance. Each team is annotated only by its own members, so this can be at most the smallest team allowed (")}{smallestTeamSize}{" "}{__msg("member")}{smallestTeamSize === 1 ? "" : "s"}
                                {String(form.minMembers) === "" ? __msg(" — Min Team Members is empty, so solo participants are accepted") : ""}).
                            </small>
                            {overTeamLimit && !errors.annotatorsPerInstance && (
                                <span className="field-warning">{__msg(annotatorLimitMessage(R, form.minMembers))}</span>
                            )}
                            <ErrorMessage name="annotatorsPerInstance" />
                        </div>
                        <div className="create-section" style={{ justifyContent: "center", opacity: canTie ? 1 : 0.6 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: canTie ? "pointer" : "not-allowed" }}>
                                <span className="switch">
                                    <input
                                        type="checkbox"
                                        checked={!!dc.adjudicationEnabled}
                                        disabled={!canTie}
                                        onChange={(e) => updateDataCollection("adjudicationEnabled", e.target.checked)}
                                    />
                                    <span className="slider" />
                                </span>
                                <div>
                                    <strong>{__msg("Adjudication on Disagreement")}</strong>
                                    <p style={{ margin: 0, fontSize: 12, color: "var(--lx-muted, #7a8b9d)" }}>{adjudicationText}</p>
                                    {dc.adjudicationEnabled && canTie && R >= smallestTeamSize && (
                                        <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--lx-gold, #a37d35)" }}>{" "}{__msg("Note: a team with only")}{" "}{smallestTeamSize}{" "}{__msg("member")}{smallestTeamSize === 1 ? "" : "s"}{" "}{__msg("(the smallest allowed) has no extra annotator to break a tie. If its")}{" "}{R}{" "}{__msg("annotators end in an exact tie, that sample stays uncompleted, and out of the final dataset, unless one of them changes their annotation. To always have a tie-breaker, set Min Team Members to at least")}{" "}{R + 1}.
                                        </p>
                                    )}
                                </div>
                            </label>
                            {canTie && !hasAgreementTasks && (
                                <small style={{ marginTop: 6 }}>{" "}{__msg("None of your tasks use labels or spans, so answers are only collected - there is nothing to tie on.")}{" "}</small>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // ── Tracks step (independent — split participants into comparison groups) ──
    const renderTracks = () => (
        <div className="create-card">
            <div className="section-header-row">
                <div>
                    <h3 className="create-card-title">{__msg("Tracks")}</h3>
                    <p className="create-card-subtitle">{" "}{__msg("Split teams into fair comparison groups (region, language, category...). A track that doesn't reach its minimum team count when you finalize the tracks (Organizer Dashboard, once registration closes) is dropped from the competition rather than merged. Each team belongs to exactly one track.")}{" "}</p>
                </div>
                <button type="button" className="soft-action-btn" onClick={addTrack}>{" "}{__msg("+ Add Track")}{" "}</button>
            </div>

            <ErrorMessage name="tracks" />

            {form.tracks.length === 0 && (
                <div className="tc-empty">
                    <p>{__msg("No tracks yet. Add at least one — e.g. \"Algiers\", \"Oran\", \"Constantine\".")}</p>
                </div>
            )}

            {form.tracks.map((track, idx) => (
                <div key={track.id} className="inner-panel">
                    <div className="create-two-col">
                        <div className="create-section">
                            <label>{__msg("Track")}{" "}{idx + 1}{" "}{__msg("Name")}{" "}<span className="required-star">*</span></label>
                            <input
                                className={errors[`trackName-${track.id}`] ? "input-error" : ""}
                                type="text"
                                placeholder={__msg("e.g., Central / Algiers")}
                                value={track.name}
                                onChange={(e) => updateTrack(track.id, "name", e.target.value)}
                            />
                            <ErrorMessage name={`trackName-${track.id}`} />
                        </div>
                        <div className="create-section">
                            <label>{__msg("Minimum Teams")}{" "}<span className="required-star">*</span></label>
                            <input
                                className={errors[`trackMin-${track.id}`] ? "input-error" : ""}
                                type="number" min="1"
                                value={track.minTeams}
                                onChange={(e) => updateTrack(track.id, "minTeams", parseInt(e.target.value, 10) || 1)}
                            />
                            <small>{__msg("Track is dropped from the competition if it doesn't reach this many teams.")}</small>
                            <ErrorMessage name={`trackMin-${track.id}`} />
                        </div>
                    </div>
                    <div className="create-section">
                        <label>{__msg("Description")}</label>
                        <textarea
                            rows={2}
                            placeholder={__msg("Shown to participants when they choose a track (e.g. which region or dialect it covers)")}
                            value={track.description || ""}
                            onChange={(e) => updateTrack(track.id, "description", e.target.value)}
                        />
                    </div>
                    <button type="button" className="remove-btn" onClick={() => removeTrack(track.id)}>{" "}{__msg("Remove Track")}{" "}</button>
                </div>
            ))}
        </div>
    );

    // ── Phases step (replaces fixed Milestones when this capability is on) ─────
    const renderPhases = () => (
        <div className="create-card">
            <div className="section-header-row">
                <div>
                    <h3 className="create-card-title">{__msg("Competition Phases")}</h3>
                    <p className="create-card-subtitle">{" "}{__msg("Add as many phases as you need and name them however you like. For each phase, choose which pages members can open; every other page is locked and tells members which phase the competition is in, using the name and description you write here. Phases run one after another starting on the start date.")}{" "}</p>
                </div>
                <button type="button" className="soft-action-btn" onClick={addPhase}>{" "}{__msg("+ Add Phase")}{" "}</button>
            </div>

            <ErrorMessage name="phases" />

            {(() => {
                const total = form.phases.reduce((s, ph) => s + (Number(ph.durationDays) || 0), 0);
                if (!form.startDate || !form.endDate)
                    return <p className="create-card-subtitle">{__msg("Phases total")}{" "}{total}{" "}{__msg("days. Set the start and end dates in Basic Info to check them against the competition window.")}</p>;
                const windowDays = Math.round((new Date(form.endDate) - new Date(form.startDate)) / 86400000) + 1;
                return (
                    <p className="create-card-subtitle" style={total > windowDays ? { color: "var(--lx-coral, #b96864)", fontWeight: 600 } : undefined}>{" "}{__msg("Phases total")}{" "}{total}{" "}{__msg("of")}{" "}{windowDays}{" "}{__msg("days in the competition window.")}{" "}</p>
                );
            })()}

            {form.phases.map((phase, idx) => (
                <div key={phase.id} className="inner-panel">
                    <div className="create-two-col">
                        <div className="create-section">
                            <label>{__msg("Phase")}{" "}{idx + 1}{" "}{__msg("Name")}{" "}<span className="required-star">*</span></label>
                            <input
                                className={errors[`phaseName-${phase.id}`] ? "input-error" : ""}
                                type="text"
                                placeholder={__msg("e.g., Data Collection & Annotation")}
                                value={phase.name}
                                onChange={(e) => updatePhase(phase.id, "name", e.target.value)}
                            />
                            <ErrorMessage name={`phaseName-${phase.id}`} />
                        </div>
                        <div className="create-section">
                            <label>{__msg("Duration (days)")}{" "}<span className="required-star">*</span></label>
                            <input
                                className={errors[`phaseDuration-${phase.id}`] ? "input-error" : ""}
                                type="number" min="1"
                                value={phase.durationDays}
                                onChange={(e) => updatePhase(phase.id, "durationDays", parseInt(e.target.value, 10) || 1)}
                            />
                            <ErrorMessage name={`phaseDuration-${phase.id}`} />
                        </div>
                    </div>
                    <div className="create-section">
                        <label>{__msg("Description")}{" "}<span className="required-star">*</span></label>
                        <textarea
                            className={errors[`phaseDesc-${phase.id}`] ? "input-error" : ""}
                            rows={2}
                            placeholder={__msg("What happens during this phase, and what freezes at the end of it? Members see this on locked pages.")}
                            value={phase.description}
                            onChange={(e) => updatePhase(phase.id, "description", e.target.value)}
                        />
                        <ErrorMessage name={`phaseDesc-${phase.id}`} />
                    </div>
                    <div className="create-section">
                        <label>{__msg("Pages members can open in this phase")}</label>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "6px 0" }}>
                            {PHASE_PAGES.map((pg) => {
                                const on = (phase.allowedPages || []).includes(pg.key);
                                return (
                                    <label
                                        key={pg.key}
                                        style={{
                                            display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
                                            padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600,
                                            border: on ? "1px solid #2bb8bf" : "1px solid var(--lx-line, #dfe7eb)",
                                            background: on ? "var(--lx-teal-soft, #edf8f6)" : "transparent",
                                        }}
                                    >
                                        <input type="checkbox" checked={on} onChange={() => togglePhasePage(phase.id, pg.key)} />
                                        {__msg(pg.label)}
                                    </label>
                                );
                            })}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button type="button" className="soft-action-btn" onClick={() => setPhasePages(phase.id, ALL_PHASE_PAGE_KEYS)}>{__msg("Select all")}</button>
                            <button type="button" className="soft-action-btn" onClick={() => setPhasePages(phase.id, [])}>{__msg("Clear")}</button>
                        </div>
                        <p className="create-card-subtitle" style={{ marginTop: 6 }}>
                            {(phase.allowedPages || []).length === 0
                                ? __msg("No pages selected: members will see every page locked during this phase (handy for a break). Support is always available.")
                                : __msg("Locked for members: {value0}. Support is always available. Organizers are never locked out.", {value0: PHASE_PAGES.filter((pg) => !(phase.allowedPages || []).includes(pg.key)).map((pg) => pg.label).join(", ") || __msg("nothing")})}
                        </p>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" className="soft-action-btn" disabled={idx === 0} onClick={() => movePhase(phase.id, -1)}>{__msg("↑ Move Up")}</button>
                        <button type="button" className="soft-action-btn" disabled={idx === form.phases.length - 1} onClick={() => movePhase(phase.id, 1)}>{__msg("↓ Move Down")}</button>
                        <button type="button" className="remove-btn" onClick={() => removePhase(phase.id)}>{__msg("Remove Phase")}</button>
                    </div>
                </div>
            ))}
        </div>
    );

    // ── License step (mandatory data-usage license when Data Collection is on) ─
    const renderLicense = () => (
        <div className="create-card">
            <h3 className="create-card-title">{__msg("Data Usage License")}</h3>
            <p className="create-card-subtitle">{" "}{__msg("Since contributed data may be published as part of a benchmark, every participant must accept this license, by version, before contributing. Store the version they accepted — don't just store a boolean — since you may need to update the license later.")}{" "}</p>

            <div className="create-section">
                <label>{__msg("License Version")}{" "}<span className="required-star">*</span></label>
                <input
                    className={errors.licenseVersion ? "input-error" : ""}
                    type="text"
                    placeholder="e.g., v1.0"
                    value={form.license.version}
                    onChange={(e) => updateLicense("version", e.target.value)}
                />
                <ErrorMessage name="licenseVersion" />
            </div>

            <div className="create-section">
                <label>{__msg("License Text")}{" "}<span className="required-star">*</span></label>
                <textarea
                    rows={10}
                    className={errors.licenseText ? "input-error" : ""}
                    placeholder={__msg("Describe what happens to contributed data: does it become part of a public benchmark? Do contributors retain any rights? Can they still download their own annotated data?")}
                    value={form.license.text}
                    onChange={(e) => updateLicense("text", e.target.value)}
                />
                <ErrorMessage name="licenseText" />
            </div>

            <div className="toggle-row">
                <div>
                    <strong>{__msg("Acceptance is Mandatory")}</strong>
                    <p>{__msg("Participants cannot contribute data until they accept this license version. This is always required whenever Data Collection is on.")}</p>
                </div>
                <label className="switch">
                    <input type="checkbox" checked readOnly disabled />
                    <span className="slider"></span>
                </label>
            </div>
        </div>
    );

    // Non-blocking hint: a metric that none of the tasks can produce an answer for.
    const metricWarning = (metric) => {
        const wanted = METRIC_ANSWER_SHAPES[metric];
        if (!wanted || !form.tasks.length) return null;
        const have = new Set(form.tasks.map((t) => taskSpec(t.type)?.answer).filter(Boolean));
        if (wanted.some((s) => have.has(s))) return null;
        return `${metric} scores ${wanted.map((s) => SHAPE_NAMES[s]).join(" / ")} answers, but none of your tasks produce those.`;
    };

    const renderEvaluation = () => (
        <div className="create-card">
            <h3 className="create-card-title">{__msg("Evaluation Metrics")}</h3>
            <p className="create-card-subtitle">{" "}{__msg("Define how submissions will be evaluated and ranked.")}{" "}</p>

            <div className="create-section">
                <label>{__msg("Primary Metric")}{" "}<span className="required-star">*</span></label>
                <select
                    className={errors.primaryMetric ? "input-error" : ""}
                    value={form.primaryMetric}
                    onChange={(e) => updateField("primaryMetric", e.target.value)}
                >
                    <option value="">{__msg("Select primary metric")}</option>
                    {primaryMetrics.map((metric) => (
                        <option key={metric} value={metric}>{__msg(metric)}</option>
                    ))}
                </select>
                <small>{__msg("Main metric used for leaderboard ranking.")}</small>
                <ErrorMessage name="primaryMetric" />
                {metricWarning(form.primaryMetric) && <span className="field-warning">{__msg(metricWarning(form.primaryMetric))}</span>}
            </div>

            <div className="create-section">
                <label>{__msg("Secondary Metric")}</label>
                <select
                    value={form.secondaryMetric}
                    onChange={(e) => updateField("secondaryMetric", e.target.value)}
                >
                    <option value="">{__msg("Select secondary metric")}</option>
                    {primaryMetrics.map((metric) => (
                        <option key={metric} value={metric}>{__msg(metric)}</option>
                    ))}
                </select>
                <small>{__msg("Optional tie-breaker metric.")}</small>
                <ErrorMessage name="secondaryMetric" />
                {metricWarning(form.secondaryMetric) && <span className="field-warning">{__msg(metricWarning(form.secondaryMetric))}</span>}
            </div>

            <div className="metric-preview">
                <div>
                    <h4>{__msg("Metric Preview")}</h4>
                    <p>{__msg("Primary:")}{" "}{form.primaryMetric || __msg("Not selected")}</p>
                    <p>{__msg("Secondary:")}{" "}{form.secondaryMetric || __msg("Not selected")}</p>
                </div>
                <span className="metric-badge">{__msg("Primary")}</span>
            </div>

            {form.participantSourcedData && (
                <div className="inner-panel">
                    <h4>{__msg("Leaderboard Scoring")}</h4>
                    <p style={{ margin: "0 0 14px", color: "var(--lx-muted, #7a8b9d)", fontSize: 13 }}>{" "}{__msg("Standard scoring ranks submissions on the metric above alone. Combined scoring also rewards the quality of the data each team contributed — useful whenever teams source their own dataset.")}{" "}</p>

                    <div className="tc-radio-group">
                        <label className={`tc-radio-option ${form.evaluationMode === "standard" ? "selected" : ""}`}>
                            <input type="radio" name="evaluationMode" checked={form.evaluationMode === "standard"}
                                onChange={() => updateField("evaluationMode", "standard")} />
                            <div>
                                <strong>{__msg("Standard")}</strong>
                                <span>{__msg("Rank purely on submission performance against the primary metric.")}</span>
                            </div>
                        </label>
                        <label className={`tc-radio-option ${form.evaluationMode === "data_quality_plus_model" ? "selected" : ""}`}>
                            <input type="radio" name="evaluationMode" checked={form.evaluationMode === "data_quality_plus_model"}
                                onChange={() => updateField("evaluationMode", "data_quality_plus_model")} />
                            <div>
                                <strong>{__msg("Data Quality + Model Score (combined)")}</strong>
                                <span>{__msg("A baseline model trained on each team's data alone scores that data's quality; combine with their own model's score.")}</span>
                            </div>
                        </label>
                    </div>

                    {form.evaluationMode === "data_quality_plus_model" && (
                        <>
                            <div className="create-two-col">
                                <div className="create-section">
                                    <label>{__msg("Data Quality Weight (%)")}{" "}<span className="required-star">*</span></label>
                                    <input
                                        type="number" min="0" max="100"
                                        value={form.dataQualityWeight}
                                        onChange={(e) => {
                                            const v = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0));
                                            updateField("dataQualityWeight", v);
                                            updateField("modelWeight", 100 - v);
                                        }}
                                    />
                                </div>
                                <div className="create-section">
                                    <label>{__msg("Model Score Weight (%)")}{" "}<span className="required-star">*</span></label>
                                    <input
                                        type="number" min="0" max="100"
                                        value={form.modelWeight}
                                        onChange={(e) => {
                                            const v = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0));
                                            updateField("modelWeight", v);
                                            updateField("dataQualityWeight", 100 - v);
                                        }}
                                    />
                                </div>
                            </div>
                            <ErrorMessage name="weightSplit" />

                            <div className="toggle-row">
                                <div>
                                    <strong>{__msg("Run Per-Team Data-Quality Baseline")}</strong>
                                    <p>{__msg("Train a baseline model on each team's data alone to produce the data quality score.")}</p>
                                </div>
                                <label className="switch">
                                    <input type="checkbox" checked={form.perTeamBaselineEnabled}
                                        onChange={(e) => updateField("perTeamBaselineEnabled", e.target.checked)} />
                                    <span className="slider"></span>
                                </label>
                            </div>

                            <div className="create-two-col">
                                <div className="create-section">
                                    <label>{__msg("Held-Out Test Fraction (%)")}</label>
                                    <input
                                        className={errors.publicTestFraction ? "input-error" : ""}
                                        type="number" min="0" max="100"
                                        value={form.publicTestFraction}
                                        onChange={(e) => updateField("publicTestFraction", parseInt(e.target.value, 10) || 0)}
                                    />
                                    <small>
                                        {form.tracksEnabled
                                            ? __msg("Share of each track's data held out for blind evaluation. Not disclosed to participants.")
                                            : __msg("Share of the dataset held out for blind evaluation. Not disclosed to participants.")}
                                    </small>
                                    <ErrorMessage name="publicTestFraction" />
                                </div>
                                <div className="create-section">
                                    <label>{form.tracksEnabled ? __msg("Winners per Track") : __msg("Number of Winners")} <span className="required-star">*</span></label>
                                    <input
                                        className={errors.winnersPerTrack ? "input-error" : ""}
                                        type="number" min="1"
                                        value={form.winnersPerTrack}
                                        onChange={(e) => updateField("winnersPerTrack", parseInt(e.target.value, 10) || 1)}
                                    />
                                    <ErrorMessage name="winnersPerTrack" />
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {!form.phasesEnabled && (
                <div className="inner-panel">
                    <h4>{__msg("Timeline Cutoffs (optional)")}</h4>
                    <p className="create-card-subtitle">{" "}{__msg("This competition isn't using the Phases timeline, so these are the only extra dates shown on the details page besides start/end.")}{" "}</p>
                    <div className="create-two-col">
                        <div className="create-section">
                            <label>{__msg("Model Validation Cutoff")}</label>
                            <input
                                className={errors.validationDate ? "input-error" : ""}
                                type="date"
                                value={form.validationDate}
                                onChange={(e) => updateField("validationDate", e.target.value)}
                            />
                            <ErrorMessage name="validationDate" />
                        </div>
                        <div className="create-section">
                            <label>{__msg("Final Leaderboard Freeze")}</label>
                            <input
                                className={errors.freezeDate ? "input-error" : ""}
                                type="date"
                                value={form.freezeDate}
                                onChange={(e) => updateField("freezeDate", e.target.value)}
                            />
                            <ErrorMessage name="freezeDate" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    const renderRules = () => (
        <div className="create-card">
            <h3 className="create-card-title">{__msg("Competition Rules & Requirements")}</h3>
            <p className="create-card-subtitle">{" "}{__msg("Optional settings for team limits, skills, and submission rules.")}{" "}</p>

            <div className="inner-panel">
                <h4>{__msg("Team Configuration")}</h4>

                <div className="create-three-col">
                    <div className="create-section">
                        <label>{__msg("Maximum Number of Teams")}</label>
                        <input
                            className={errors.maxTeams ? "input-error" : ""}
                            type="number"
                            placeholder="e.g., 100"
                            value={form.maxTeams}
                            onChange={(e) => updateField("maxTeams", e.target.value)}
                        />
                        <small>{__msg("Leave empty or set 0 for unlimited teams.")}</small>
                        <ErrorMessage name="maxTeams" />
                    </div>

                    <div className="create-section">
                        <label>{__msg("Min Team Members")}</label>
                        <input
                            className={errors.minMembers ? "input-error" : ""}
                            type="number"
                            placeholder="e.g., 1"
                            value={form.minMembers}
                            onChange={(e) => updateField("minMembers", e.target.value)}
                        />
                        <ErrorMessage name="minMembers" />
                    </div>

                    <div className="create-section">
                        <label>{__msg("Max Team Members")}</label>
                        <input
                            className={errors.maxMembers ? "input-error" : ""}
                            type="number"
                            placeholder="e.g., 5"
                            value={form.maxMembers}
                            onChange={(e) => updateField("maxMembers", e.target.value)}
                        />
                        <ErrorMessage name="maxMembers" />
                    </div>
                </div>

                <div className="create-section">
                    <label>{__msg("Team Merger Deadline")}</label>
                    <input
                        className={errors.mergeDeadline ? "input-error" : ""}
                        type="date"
                        value={form.mergeDeadline}
                        onChange={(e) => updateField("mergeDeadline", e.target.value)}
                    />
                    <small>{__msg("Optional. Must be between start and end date.")}</small>
                    <ErrorMessage name="mergeDeadline" />
                </div>
            </div>

            <div className="create-section">
                <label>{__msg("Required Skills")}</label>
                <small>{__msg("Optional. Pick skills from the predefined list.")}</small>

                <div className="skills-select">
                    <button
                        type="button"
                        className="skills-select-btn"
                        onClick={() => setSkillsOpen((prev) => !prev)}
                    >
                        {form.requiredSkills.length === 0
                            ? __msg("Select required skills")
                            : __msg("{value0} skill(s) selected", {value0: form.requiredSkills.length})}
                        <span>⌄</span>
                    </button>

                    {skillsOpen && (
                        <div className="skills-dropdown">
                            {PREDEFINED_SKILLS.map((skill) => {
                                const selected = form.requiredSkills.includes(skill);
                                return (
                                    <button
                                        key={skill}
                                        type="button"
                                        className={selected ? "skill-option selected" : "skill-option"}
                                        onClick={() => toggleSkill(skill)}
                                    >
                                        <span>{skill}</span>
                                        {selected && <strong>✓</strong>}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {form.requiredSkills.length > 0 && (
                    <div className="selected-skills">
                        {form.requiredSkills.map((skill) => (
                            <button
                                key={skill}
                                type="button"
                                onClick={() => toggleSkill(skill)}
                            >
                                {skill} ×
                            </button>
                        ))}
                    </div>
                )}

                {form.requiredSkills.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                        <label>{__msg("Who in a team needs each skill?")}</label>
                        <small>{" "}{__msg("Individuals joining solo need every required skill. For teams, choose how many members must have each one — at least one, several, or everyone.")}{" "}</small>
                        {form.requiredSkills.map((skill) => {
                            // never offer "at least N members" for more members than a team can have
                            const cap = Math.max(
                                Number(form.maxMembers) > 0 ? Number(form.maxMembers) : 10,
                                Number(form.teamSkillMembers[skill]) || 0
                            );
                            return (
                                <div key={skill} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                                    <span style={{ minWidth: 140, fontWeight: 600 }}>{skill}</span>
                                    <select
                                        value={form.teamSkillMembers[skill] ?? 1}
                                        onChange={(e) =>
                                            updateField("teamSkillMembers", {
                                                ...form.teamSkillMembers,
                                                [skill]: e.target.value === "all" ? "all" : Number(e.target.value),
                                            })
                                        }
                                    >
                                        <option value={1}>{__msg("At least 1 member")}</option>
                                        {Array.from({ length: cap - 1 }, (_, i) => i + 2).map((n) => (
                                            <option key={n} value={n}>{__msg("At least")}{" "}{n}{" "}{__msg("members")}</option>
                                        ))}
                                        <option value="all">{__msg("Every member")}</option>
                                    </select>
                                </div>
                            );
                        })}
                        <ErrorMessage name="teamSkillMembers" />
                    </div>
                )}
            </div>

            <div className="inner-panel">
                <h4>{__msg("Submission Rules")}</h4>

                <div className="create-section">
                    <label>{__msg("Maximum Submissions Per Day")}</label>
                    <input
                        className={errors.maxSubmissionsPerDay ? "input-error" : ""}
                        type="number"
                        placeholder="e.g., 5"
                        value={form.maxSubmissionsPerDay}
                        onChange={(e) => updateField("maxSubmissionsPerDay", e.target.value)}
                    />
                    <small>{__msg("Optional. Leave empty for no daily limit.")}</small>
                    <ErrorMessage name="maxSubmissionsPerDay" />
                </div>

                <div className="toggle-row">
                    <div>
                        <strong>{__msg("Allow External Data")}</strong>
                        <p>{__msg("Can participants use datasets not provided by organizers?")}</p>
                    </div>
                    <label className="switch">
                        <input type="checkbox" checked={form.allowExternalData}
                            onChange={(e) => updateField("allowExternalData", e.target.checked)} />
                        <span className="slider"></span>
                    </label>
                </div>

                {form.participantSourcedData && !form.allowExternalData
                    && (form.dataCollection.allowedSourceTypes || []).some((s) => s !== "self_recorded") && (
                    <p className="field-warning">{" "}{__msg("External data is switched off, yet Data Collection lets contributors use public platforms or existing datasets. Participants will see both rules - make sure that is what you intend.")}{" "}</p>
                )}

                <div className="toggle-row">
                    <div>
                        <strong>{__msg("Allow Pre-trained Models")}</strong>
                        <p>{__msg("Can participants use pre-trained models such as BERT or GPT?")}</p>
                    </div>
                    <label className="switch">
                        <input type="checkbox" checked={form.allowPretrainedModels}
                            onChange={(e) => updateField("allowPretrainedModels", e.target.checked)} />
                        <span className="slider"></span>
                    </label>
                </div>

                <div className="toggle-row">
                    <div>
                        <strong>{__msg("Require Code Sharing")}</strong>
                        <p>{__msg("Must winners share their code and solution?")}</p>
                    </div>
                    <label className="switch">
                        <input type="checkbox" checked={form.requireCodeSharing}
                            onChange={(e) => updateField("requireCodeSharing", e.target.checked)} />
                        <span className="slider"></span>
                    </label>
                </div>
            </div>

            <div className="inner-panel">
                <h4>{__msg("Join Method")}</h4>
                <p style={{ margin: "0 0 14px", color: "var(--lx-muted, #7a8b9d)", fontSize: 13 }}>{" "}{__msg("How will participants or teams be accepted into this competition?")}{" "}</p>

                <div className="complexity-list">
                    <button
                        type="button"
                        className={form.joinMethod === "auto" ? "complexity-option active" : "complexity-option"}
                        onClick={() => updateField("joinMethod", "auto")}
                    >
                        <strong>{__msg("Automatic Acceptance")}</strong>
                        <span>{" "}{__msg("Participants or teams that satisfy all requirements (team size, skills) are accepted instantly — no organizer action needed.")}{" "}</span>
                    </button>

                    <button
                        type="button"
                        className={form.joinMethod === "manual" ? "complexity-option active" : "complexity-option"}
                        onClick={() => updateField("joinMethod", "manual")}
                    >
                        <strong>{__msg("Manual Approval")}</strong>
                        <span>{" "}{__msg("Every join request is held in a queue. You review and approve or reject each participant / team from the Organizer Dashboard.")}{" "}</span>
                    </button>
                </div>

                {form.joinMethod === "manual" && (
                    <div style={{
                        marginTop: 12, padding: "10px 14px", borderRadius: 8,
                        background: "var(--lx-teal-soft, #fff9eb)", border: "1px solid var(--lx-line, #ead7a5)",
                        fontSize: 12, color: "var(--lx-gold, #a37d35)",
                    }}>{" "}{__msg("⚠️ With manual approval you must actively review join requests from the Organizer Dashboard → Join Requests tab.")}{" "}</div>
                )}
            </div>

            <div className="create-section">
                <label>{__msg("Additional Rules & Guidelines")}</label>
                <textarea
                    rows="3"
                    placeholder={__msg("Specify extra rules, ethics requirements, prize distribution terms...")}
                    value={form.additionalRules}
                    onChange={(e) => updateField("additionalRules", e.target.value)}
                />
            </div>
        </div>
    );

    const renderComplexity = () => (
        <div className="create-card">
            <h3 className="create-card-title">{__msg("Challenge Complexity")}</h3>
            <p className="create-card-subtitle">{__msg("Choose the difficulty level of this competition.")}</p>

            <div className="create-section">
                <label>{__msg("Complexity Level")}</label>
                <div className="complexity-list">
                    {complexityLevels.map((level, index) => (
                        <button
                            key={level.title}
                            type="button"
                            className={form.complexityLevel === index ? "complexity-option active" : "complexity-option"}
                            onClick={() => updateField("complexityLevel", index)}
                        >
                            <strong>{__msg(level.title)}</strong>
                            <span>{__msg(level.description)}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );

    const renderDatasets = () => {
        if (savingDraft) {
            return (
                <div className="create-card" style={{ textAlign: "center", padding: "48px 24px" }}>
                    <p style={{ color: "var(--lx-muted, #7a8b9d)", fontSize: 14 }}>{" "}{__msg("⏳ Saving draft to enable dataset upload…")}{" "}</p>
                </div>
            );
        }

        if (draftError) {
            return (
                <div className="create-card" style={{ textAlign: "center", padding: "48px 24px" }}>
                    <p style={{ color: "var(--lx-coral, #b96864)", fontSize: 14, marginBottom: 12 }}>{" "}{__msg("⚠️ Could not save draft:")}{" "}{draftError}
                    </p>
                    <button
                        type="button"
                        className="footer-primary-btn"
                        onClick={() => {
                            setDraftError(null);
                            setSavedCompetitionId(null);
                            setDraftAttempt((n) => n + 1);   // the auto-save effect depends on this
                        }}
                    >{" "}{__msg("Retry")}{" "}</button>
                </div>
            );
        }

        return (
            <DatasetSection competitionId={savedCompetitionId} />
        );
    };

    const renderCurrentStep = () => {
        switch (wizardSteps[currentStep]?.key) {
            case "basic": return renderBasicInfo();
            case "assets": return renderAssets();
            case "tasks": return renderTasks();
            case "dataCollection": return renderDataCollection();
            case "tracks": return renderTracks();
            case "phases": return renderPhases();
            case "license": return renderLicense();
            case "evaluation": return renderEvaluation();
            case "rules": return renderRules();
            case "complexity": return renderComplexity();
            case "datasets": return renderDatasets();
            default: return null;
        }
    };

    if (loadingEditData) {
        return (
            <div className="create-page create-refresh">
                <Sidebar />
                <div className="create-main">
                    <div className="create-content">
                        <div className="create-card">
                            <h3>{__msg("Loading competition data...")}</h3>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="create-page create-refresh">
            <Sidebar />

            <div className="create-main">
                <Topbar />
                <main className="create-content">
                    <header className="create-intro">
                        <div><p className="create-eyebrow"><Sparkles size={13}/>{" "}{__msg("ORGANIZER STUDIO")}</p>
                        <h1>{isEditMode ? __msg("Refine your challenge") : __msg("Make room for the next big idea")}<span>.</span></h1>
                        <p>{__msg("Bring people, language, and data together. Shape your challenge one step at a time.")}</p></div>
                        <button type="button" className="topbar-text-btn" onClick={handleCancel}><ArrowLeft size={15}/>{" "}{__msg("Back to")}{" "}{isEditMode ? __msg("organizer") : __msg("competitions")}</button>
                    </header>
                    <div className="create-studio-grid">
                    <aside className="create-guide">
                        <span className="create-guide-icon"><Lightbulb size={21}/></span>
                        <h2>{__msg("A great challenge starts with clarity.")}</h2>
                        <p>{__msg("Describe the goal, define the data, and give participants a clear path to their first submission.")}</p>
                        <div className="create-guide-current"><span>{__msg("YOU’RE WORKING ON")}</span><strong>{wizardSteps[currentStep]?.label}</strong><small>{__msg("Step")}{" "}{currentStep + 1}{" "}{__msg("of")}{" "}{wizardSteps.length}</small></div>
                        <p className="create-guide-note">{__msg("Tracks, phases, and participant data collection are optional. Your setup adapts as you choose.")}</p>
                    </aside>
                    <div className="create-wizard">
                    <div className="wizard-head">
                        <div className="wizard-title-row">
                            <h2 ref={stepHeading} tabIndex={-1}>{wizardSteps[currentStep]?.label}</h2>
                            <span>{__msg("Step")}{" "}{currentStep + 1}{" "}{__msg("of")}{" "}{wizardSteps.length}</span>
                        </div>

                        <div className="wizard-progress" role="progressbar" aria-label={__msg("Competition setup progress")} aria-valuenow={currentStep + 1} aria-valuemin={0} aria-valuemax={wizardSteps.length}>
                            <div className="wizard-progress-fill" style={{ width: `${progressPercent}%` }} />
                        </div>

                        <div className="wizard-tabs">
                            {wizardSteps.map((step, index) => (
                                <button
                                    key={step.key}
                                    type="button"
                                    aria-current={currentStep === index ? "step" : undefined}
                                    className={currentStep === index ? "wizard-tab active" : "wizard-tab"}
                                    onClick={() => {
                                        if (index <= currentStep) { setCurrentStep(index); return; }
                                        for (let s = currentStep; s < index; s++) {
                                            if (!validateStep(s)) { setCurrentStep(s); return; }
                                        }
                                        setCurrentStep(index);
                                    }}
                                >
                                    <span className="wizard-step-number">{index < currentStep ? <Check size={11}/> : index + 1}</span>{__msg(step.label)}
                                </button>
                            ))}
                        </div>
                    </div>

                    {Object.keys(errors).length > 0 && <p className="create-validation-summary" role="alert">{__msg("Please review the highlighted fields before continuing.")}</p>}
                    {renderCurrentStep()}

                    <div className="wizard-footer">
                        <button
                            type="button"
                            className="footer-secondary-btn"
                            onClick={handlePrevious}
                            disabled={currentStep === 0 || submitting}
                        >
                            <ArrowLeft size={15}/>{" "}{__msg("Previous")}{" "}</button>

                        {currentStep < wizardSteps.length - 1 ? (
                            <button
                                type="button"
                                className="footer-primary-btn"
                                onClick={handleNext}
                                disabled={submitting}
                            >{" "}{__msg("Next Step")}{" "}<ArrowRight size={15}/>
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="footer-success-btn"
                                onClick={submitCompetition}
                                disabled={submitting}
                            >
                                {submitting
                                    ? isEditMode ? __msg("Updating...") : __msg("Creating...")
                                    : isEditMode ? __msg("Update Competition") : __msg("Create Competition")}
                            </button>
                        )}
                    </div>
                    </div>
                    </div>
                </main>
            </div>
        </div>
    );
}

export default CreateCompetition;
