import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ChevronDown, ChevronRight,
  CircleHelp, ClipboardList, Database, FileText, FlaskConical, Search,
  Sparkles, Trophy, Users, X,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import "../styles/resources.css";
import "../styles/directoryRefresh.css";

const CATEGORIES = [
  { id: "all", label: "All guides" },
  { id: "start", label: "Getting started" },
  { id: "competitions", label: "Competitions" },
  { id: "teams", label: "Teams" },
  { id: "data", label: "Data & annotation" },
  { id: "evaluation", label: "Evaluation" },
];

// Documentation is deliberately about implemented platform workflows. Update these
// entries when routes, permissions, or workflows change.
const GUIDES = [
  {
    id: "first-steps", category: "start", icon: BookOpen, title: "Find your way around Lexivia",
    description: "Understand your workspace and where to find competitions, teams, and datasets.",
    audience: "Everyone", minutes: 2,
    steps: [
      { title: "Open your Dashboard", body: "Your workspace summarizes your current competitions, drafts, samples you've contributed, and assignments you've completed." },
      { title: "Browse competitions", body: "Use Competitions to discover published challenges. Select one to review its description, requirements, tasks, rules, and dates." },
      { title: "Use the relevant workspace", body: "After joining, follow the competition's available workflows. Data collection, annotation, and experiments may differ by competition configuration." },
    ],
    action: { label: "Browse competitions", path: "/competitions" },
  },
  {
    id: "join", category: "competitions", icon: Trophy, title: "Join a competition",
    description: "Check eligibility, choose an individual or team entry, and accept competition rules.",
    audience: "Participants", minutes: 3,
    steps: [
      { title: "Read the competition details", body: "Check the competition status, dates, required skills, team conditions, and participation rules before requesting to join." },
      { title: "Choose how to participate", body: "Open Join Competition. Depending on its rules, you may enter individually or with a team you lead. The form shows eligible options." },
      { title: "Select a track if required", body: "Competitions with tracks require you to select an available track when joining." },
      { title: "Accept the rules and submit", body: "Automatic joining completes when server-side checks pass. For manual joining, the request stays pending until an organizer reviews it." },
    ],
    action: { label: "Explore competitions", path: "/competitions" },
  },
  {
    id: "organize", category: "competitions", icon: ClipboardList, title: "Create and manage a competition",
    description: "Define assets and tasks, publish a challenge, and monitor participation.",
    audience: "Organizers", minutes: 4,
    steps: [
      { title: "Create or continue a draft", body: "Use Create competition to set up the title, description, dates, evaluation metric, eligibility rules, and sample structure." },
      { title: "Define the work", body: "Assets describe what a sample contains; tasks describe what participants or annotators do with those assets. Optional features include tracks, phases, and data collection." },
      { title: "Publish and monitor", body: "Once your configuration is ready, publish the competition. Use the organizer dashboard to review participation, submissions, and annotation progress when configured." },
      { title: "Update carefully", body: "Use Edit Competition for configuration changes. Existing participant activity can make changes to a live competition consequential." },
    ],
    action: { label: "Create competition", path: "/create-competition" },
  },
  {
    id: "teams", category: "teams", icon: Users, title: "Participate as a team",
    description: "Understand team leadership, eligibility, and competition joining.",
    audience: "Team members", minutes: 3,
    steps: [
      { title: "Manage your team", body: "Open Teams to work with your teams and invitations." },
      { title: "Check competition requirements", body: "Each competition can specify team size, required skills, and how many members must possess a skill." },
      { title: "Have the leader join", body: "The team leader submits the competition join request on behalf of the team. The join dialog explains why a team is ineligible, if applicable." },
    ],
    action: { label: "Open teams", path: "/teams" },
  },
  {
    id: "collection", category: "data", icon: Database, title: "Contribute samples",
    description: "Understand participant-sourced samples and when collection is available.",
    audience: "Contributors", minutes: 3,
    steps: [
      { title: "Check whether collection is enabled", body: "Not every competition uses participant-sourced Data Collection. It is an optional competition capability." },
      { title: "Open Data Collection", body: "For a competition with Data Collection enabled, use its collection workspace to submit samples in the configured asset format, such as text or audio." },
      { title: "Follow source and usage rules", body: "The organizer may define permitted source types and a data usage license. Review these before contributing." },
      { title: "Track progress", body: "Organizers can monitor sample counts and the subsequent annotation process in their competition dashboard." },
    ],
    action: { label: "View competitions", path: "/competitions" },
  },
  {
    id: "annotation", category: "data", icon: CheckCircle2, title: "Complete annotation assignments",
    description: "Learn how samples are assigned, submitted, and resolved when annotators disagree.",
    audience: "Annotators", minutes: 4,
    steps: [
      { title: "Open the annotation workspace", body: "Join an eligible competition, then open its Data Annotation page when annotation has been configured." },
      { title: "Receive an available sample", body: "The platform assigns work automatically. If you already have an active assignment, you may resume it." },
      { title: "Submit task answers", body: "Complete the tasks shown for the sample. The system can save partial answers and records assignment status." },
      { title: "Understand disagreements", body: "Independent answers are evaluated for conflicts. Depending on competition settings, an additional annotator may resolve disagreements or conflicts may be flagged for organizer review." },
    ],
    action: { label: "Find a competition", path: "/competitions" },
  },
  {
    id: "datasets", category: "data", icon: FileText, title: "When does a dataset become public?",
    description: "Distinguish private reference files from published collected datasets.",
    audience: "Everyone", minutes: 2,
    steps: [
      { title: "Understand the two dataset workflows", body: "Organizers can upload reference or evaluation files. Separately, data collection creates samples and annotation records." },
      { title: "Wait for competition closure", body: "The public Dataset Hub publishes collected samples only once their competition has closed. Open, upcoming, and draft competitions are not published there." },
      { title: "Browse published datasets", body: "After closure, competitions with collected samples can appear in the Dataset Hub, with dataset structure and statistics." },
    ],
    action: { label: "Explore datasets", path: "/datasets" },
  },
  {
    id: "evaluation", category: "evaluation", icon: FlaskConical, title: "Understand evaluation and rankings",
    description: "Learn what evaluation metrics, model submissions, and leaderboards represent.",
    audience: "Participants", minutes: 3,
    steps: [
      { title: "Check the configured metric", body: "A competition's organizer chooses a primary metric, and may configure further evaluation settings." },
      { title: "Prepare the competition-specific model workflow", body: "Some competitions provide an experiments and model submission workflow. Follow that competition's workspace and submission rules." },
      { title: "Review the leaderboard", body: "Ranked results depend on successfully evaluated submissions. A competition with no scored submissions has no meaningful ranking yet." },
      { title: "Interpret scores in context", body: "Higher scores are better for some metrics, while errors such as RMSE or WER are usually better when lower." },
    ],
    action: { label: "Browse competitions", path: "/competitions" },
  },
];

const FAQS = [
  { q: "Why can't I join a competition?", a: "The competition may not be open, may be full, or may require different skills, team size, or membership. Open Join Competition to see the eligibility information returned by the platform." },
  { q: "Why is my join request pending?", a: "The organizer selected manual approval. Your request remains pending until an organizer approves or rejects it." },
  { q: "Why can't I see a dataset in the public hub?", a: "Collected datasets are published through the public Dataset Hub only after the associated competition closes and has collected samples. Private evaluation files are separate." },
  { q: "Why is the leaderboard empty?", a: "The leaderboard needs successfully evaluated model submissions. An empty leaderboard does not necessarily indicate an error." },
  { q: "Why is there no annotation task available?", a: "Annotation may not be configured, no samples may be available, or there may be no eligible unassigned work for you at the moment." },
];

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

export default function Resources() {
  const [language] = useInterfaceLanguage();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [openFaq, setOpenFaq] = useState(-1);
  const articleHeading = useRef(null);
  useEffect(() => {
    if (selectedId) {
      articleHeading.current?.focus({preventScroll:true});
      articleHeading.current?.scrollIntoView({block:"start"});
    }
  }, [selectedId]);
  const selected = GUIDES.find((guide) => guide.id === selectedId);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  // Searching spans ALL guides. Category chips filter only when search is cleared.
  // This prevents an active category from silently hiding valid search matches.
  const filtered = useMemo(() => {
    return GUIDES.filter((guide) => {
      if (!normalizedQuery && category !== "all" && guide.category !== category) return false;
      if (!normalizedQuery) return true;
      const text = [guide.title, guide.description, guide.audience,
        CATEGORY_LABELS[guide.category],
        ...guide.steps.flatMap((step) => [step.title, step.body])].flatMap(value => [value, __msg(value)]).join(" ").toLocaleLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [normalizedQuery, category, language]);
  const filteredFaqs = useMemo(() => FAQS.map((faq, idx) => ({ ...faq, idx }))
    .filter((faq) => !normalizedQuery || `${__msg(faq.q)} ${__msg(faq.a)}`.toLocaleLowerCase().includes(normalizedQuery)), [normalizedQuery, language]);


  return (
    <div className="res-shell resources-refresh">
      <Sidebar />
      <div className="res-page">
        <Topbar />
        <main className="res-main">
          {selected ? (
            <>
              <button type="button" className="res-back" onClick={() => setSelectedId(null)}><ArrowLeft size={17} />{" "}{__msg("All resources")}</button>
              <article className="res-article">
                <div className="res-article-top"><span className="res-eyebrow">{__msg(CATEGORY_LABELS[selected.category])}</span><span className="res-meta">{__msg("{count} min read", {count:selected.minutes})} · {__msg(selected.audience)}</span></div>
                <h1 ref={articleHeading} tabIndex={-1}>{__msg(selected.title)}</h1>
                <p className="res-article-lede">{__msg(selected.description)}</p>
                <div className="res-article-steps">
                  {selected.steps.map((step, idx) => <section key={step.title} className="res-step"><span className="res-step-number">{idx + 1}</span><div><h2>{__msg(step.title)}</h2><p>{__msg(step.body)}</p></div></section>)}
                </div>
                {selected.action && <button type="button" className="res-primary" onClick={() => navigate(selected.action.path)}>{__msg(selected.action.label)}<ArrowRight size={17} /></button>}
              </article>
            </>
          ) : (
            <>
              <header className="res-header">
                <div><div className="res-eyebrow"><Sparkles size={14} />{" "}{__msg("LEXIVIA HELP CENTER")}</div><h1>{__msg("A little guidance. A lot of possibility")}<span>.</span></h1><p>{__msg("Find your next step with practical guides to learning, building, and collaborating on Lexivia.")}</p></div>
                <div className="res-header-mark" aria-hidden="true"><BookOpen size={34} /></div>
              </header>
              <div className="res-search-wrap"><Search size={20} aria-hidden="true" /><input type="search" aria-label={__msg("Search resources")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={__msg("Search all guides and FAQs…")} />{query && <button type="button" aria-label={__msg("Clear resource search")} onClick={() => setQuery("")}><X size={18} /></button>}</div>
              <section className="res-section" aria-label={__msg("Guides")}>
                <div className="res-section-heading"><div><h2>{__msg("Explore guides")}</h2><p>{normalizedQuery ? __msg("Searching across all categories") : __msg("Start with a topic or search for something specific.")}</p></div><span className="res-count">{__msg("{count} guides", {count:filtered.length})}</span></div>
                <div className="res-filters" role="group" aria-label={__msg("Guide categories")}>{CATEGORIES.map((item) => <button key={item.id} type="button" aria-pressed={category === item.id} className={category === item.id ? "selected" : ""} onClick={() => { setCategory(item.id); setQuery(""); }}>{__msg(item.label)}</button>)}</div>
                {filtered.length ? <div className="res-grid">{filtered.map((guide) => { const Icon = guide.icon; return <button key={guide.id} type="button" className="res-guide" onClick={() => setSelectedId(guide.id)}><div className="res-guide-head"><span className="res-guide-icon"><Icon size={21} /></span><ChevronRight size={19} className="res-guide-chevron" /></div><span className="res-guide-category">{__msg(CATEGORY_LABELS[guide.category])}</span><h3>{__msg(guide.title)}</h3><p>{__msg(guide.description)}</p><div className="res-guide-footer">{__msg(guide.audience)}<span>{__msg("{count} min read", {count:guide.minutes})}</span></div></button>; })}</div> : <div className="res-no-results"><Search size={24} /><strong>{__msg("No matching guides")}</strong><p>{__msg("Try a shorter term, or clear your search to browse all guides.")}</p><button type="button" onClick={() => { setQuery(""); setCategory("all"); }}>{__msg("Show all guides")}</button></div>}
              </section>
              <section className="res-faq-section" aria-labelledby="res-faq-title"><div className="res-section-heading"><div><h2 id="res-faq-title"><CircleHelp size={21} />{" "}{__msg("Frequently asked questions")}</h2><p>{__msg("Quick answers to common platform questions.")}</p></div></div><div className="res-faq-list">{filteredFaqs.map((faq) => <div key={faq.q} className="res-faq-item"><button type="button" aria-expanded={openFaq === faq.idx} onClick={() => setOpenFaq(openFaq === faq.idx ? -1 : faq.idx)}>{__msg(faq.q)}<ChevronDown className={openFaq === faq.idx ? "expanded" : ""} size={19} /></button>{openFaq === faq.idx && <p>{__msg(faq.a)}</p>}</div>)}</div>{filteredFaqs.length === 0 && <p className="res-faq-empty">{__msg("No matching FAQs.")}</p>}</section>
              
            </>
          )}
        </main>
      </div>
    </div>
  );
}
