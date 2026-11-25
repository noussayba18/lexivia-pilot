import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ArrowDown, Check, CheckCheck, ChevronRight, Database, FlaskConical, Layers3, Menu, MessageSquare, Mic, Sparkles, Trophy, Users, X } from 'lucide-react'
import s from '../styles/landing.module.css'
import BrandLogo from '../components/BrandLogo'
import LandingCompanion from '../components/LandingCompanion'

const stages = [
  { title: 'Find your next challenge.', short: 'Discover & connect', text: 'Explore NLP competitions, bring your team together, and turn a shared question into your next project.', icon: Users },
  { title: 'Give your data meaning.', short: 'Collect & annotate', text: 'Bring text and speech into one workspace. Add labels, review annotations, and build a dataset your team can work with.', icon: Database },
  { title: 'Make room for discovery.', short: 'Train & experiment', text: 'Take your dataset into the modeling workspace. Track experiments and compare results as your ideas evolve.', icon: FlaskConical },
  { title: 'Let your work speak.', short: 'Submit & compare', text: 'Submit your solution, see how it performs, and learn from a leaderboard built around the competition’s evaluation metric.', icon: Trophy },
]
const leaderboard = [
  { name: 'Atlas NLP', initials: 'AT', score: '0.942', color: 'teal' },
  { name: 'Syntax Squad', initials: 'SY', score: '0.916', color: 'gold' },
  { name: 'VoiceMind', initials: 'VM', score: '0.887', color: 'coral' },
]

function Wordmark() { return <span className={s.wordmark}><BrandLogo /></span> }

function LineChart({ compact = false }) {
  useInterfaceLanguage();
  const fillId = useId()
  return <svg className={`${s.lineChart} ${compact ? s.compactChart : ''}`} viewBox="0 0 640 250" role="img" aria-label={__msg("Illustrative model score rising across experiments, from 0.62 to 0.94")}>
    <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#2BB8BF" stopOpacity=".3" /><stop offset="1" stopColor="#2BB8BF" stopOpacity="0" /></linearGradient></defs>
    {[45, 100, 155, 210].map(y => <line key={y} x1="30" x2="615" y1={y} y2={y} className={s.chartGrid} />)}
    <path className={s.chartArea} d="M30 210 L95 195 L160 202 L225 158 L290 149 L355 110 L420 120 L485 75 L550 58 L615 25 L615 225 L30 225 Z" fill={`url(#${fillId})`} />
    <path className={s.chartLine} pathLength="1" d="M30 210 L95 195 L160 202 L225 158 L290 149 L355 110 L420 120 L485 75 L550 58 L615 25" />
    <circle className={s.chartDot} cx="615" cy="25" r="6" />
    {!compact && <g className={s.chartLabels}><text x="30" y="247">{__msg("First experiment")}</text><text x="505" y="247">{__msg("Latest iteration")}</text></g>}
  </svg>
}

function DemoWindow({ children, title }) {
  useInterfaceLanguage();
  return <div className={s.demoWindow}><div className={s.windowBar}><span className={s.windowDots}><i /><i /><i /></span><span>{__msg(title)}</span><span className={s.demoLabel}>DEMO</span></div>{children}</div>
}

function Avatars() { return <div className={s.avatars}><span>AM</span><span>YL</span><span>SK</span></div> }

function StageVisual({ index }) {
  useInterfaceLanguage();
  if (index === 0) return <DemoWindow title={__msg("Your next challenge")}><div className={s.challengeVisual}>
    <div className={s.visualIcon}><MessageSquare size={30} /></div><span className={s.statusBadge}><i />{" "}{__msg("NLP competition")}</span>
    <h4>{__msg("Understand the sentiment.")}<br />{__msg("Discover the possibilities.")}</h4><p>{__msg("Arabic sentiment classification")}</p>
    <div className={s.challengeTags}><span>{__msg("Text classification")}</span><span>Macro F1</span></div>
    <div className={s.teamStrip}><Avatars /><div><strong>{__msg("Different minds. Shared ambition.")}</strong><small>{__msg("Your team’s next chapter starts here.")}</small></div></div>
  </div></DemoWindow>
  if (index === 1) return <DemoWindow title={__msg("Dataset studio")}><div className={s.annotationVisual}>
    <div className={s.visualHeading}><span><Database size={16} />{" "}{__msg("Sentiment dataset")}</span><span className={s.subtle}>{__msg("Sample 24 / 100")}</span></div>
    <div className={s.sampleText}><span>{__msg("TEXT SAMPLE")}</span><p>{__msg("“A thoughtful idea, brought to life beautifully.”")}</p></div>
    <span className={s.fieldLabel}>{__msg("Choose a sentiment")}</span><div className={s.labelOptions}><span className={s.selectedLabel}><Check size={14} />{" "}{__msg("Positive")}</span><span>{__msg("Neutral")}</span><span>{__msg("Negative")}</span></div>
    <div className={s.annotationProgress}><span>{__msg("Dataset annotation")}</span><strong>78%</strong></div><div className={s.progressTrack}><span /></div>
    <div className={s.reviewNote}><CheckCheck size={16} />{" "}{__msg("Every label brings your dataset into focus.")}</div>
  </div></DemoWindow>
  if (index === 2) return <DemoWindow title={__msg("Experiment workspace")}><div className={s.experimentVisual}>
    <div className={s.visualHeading}><span><FlaskConical size={16} />{" "}{__msg("Experiment overview")}</span><span className={s.statusBadge}>{__msg("Completed")}</span></div>
    <div className={s.experimentScore}><span>Macro F1-score<strong>0.942<small> +0.026</small></strong></span><span className={s.runTag}>{__msg("Run 010")}</span></div>
    <LineChart compact /><div className={s.runRow}><span><i /> sentiment-model-v3</span><span>{__msg("Latest experiment")}</span></div>
  </div></DemoWindow>
  return <DemoWindow title={__msg("Competition leaderboard")}><div className={s.leaderboardVisual}>
    <div className={s.visualHeading}><span><Trophy size={17} />{" "}{__msg("A little friendly competition.")}</span></div><p>{__msg("One challenge. Different approaches.")}</p>
    <div className={s.tableHead}><span>{__msg("TEAM")}</span><span>MACRO F1</span></div>
    {leaderboard.map((team, i) => <div className={s.leaderRow} key={team.name}><span className={s.rank}>0{i + 1}</span><span className={`${s.teamAvatar} ${s[team.color]}`}>{team.initials}</span><strong>{team.name}</strong><span className={s.score}>{team.score}</span></div>)}
    <div className={s.reviewNote}><CheckCheck size={16} />{" "}{__msg("Compare results. Find your next improvement.")}</div>
  </div></DemoWindow>
}

export default function Landing() {
  useInterfaceLanguage();
  const root = useRef(null)
  const panels = useRef([])
  const [activeStage, setActiveStage] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const signedIn = Boolean(localStorage.getItem('token') && localStorage.getItem('user'))
  const startUrl = signedIn ? '/dashboard' : '/signup'

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Lexivia — Where language meets possibility'
    const page = root.current
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add(s.visible); revealObserver.unobserve(entry.target) }
      })
    }, { threshold: 0.12 })
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) page.classList.add(s.motionReady)
    page.querySelectorAll('[data-reveal]').forEach(element => revealObserver.observe(element))
    let frame = 0
    const updateStage = () => {
      let closest = 0
      let distance = Infinity
      panels.current.forEach((panel, index) => {
        if (!panel) return
        const bounds = panel.getBoundingClientRect()
        const nextDistance = Math.abs(bounds.top + bounds.height / 2 - window.innerHeight * 0.52)
        if (nextDistance < distance) { closest = index; distance = nextDistance }
      })
      setActiveStage(closest)
      frame = 0
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(updateStage) }
    updateStage()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      document.title = previousTitle
      revealObserver.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const close = event => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [menuOpen])

  const goToStage = index => panels.current[index]?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' })

  return <div className={s.page} ref={root} id="landing-top">
    <LandingCompanion />
    <a className={s.skipLink} href="#landing-main">{__msg("Skip to content")}</a>
    <header className={s.header}><div className={s.navInner}>
      <a href="#landing-top" aria-label={__msg("Lexivia home")} className={s.brand}><Wordmark /></a>
      <nav aria-label={__msg("Main navigation")} id="landing-navigation" className={`${s.navLinks} ${menuOpen ? s.navOpen : ''}`}>
        {[['The platform', '#platform'], ['How it works', '#workflow'], ['Possibilities', '#possibilities']].map(([label, href]) => <a href={href} key={href} onClick={() => setMenuOpen(false)}>{__msg(label)}</a>)}
        <Link className={s.mobileLogin} to={signedIn ? '/dashboard' : '/login'}>{signedIn ? __msg("Dashboard") : __msg("Log in")} <ArrowUpRight size={16} /></Link>
      </nav>
      <div className={s.navActions}><Link className={s.login} to={signedIn ? '/dashboard' : '/login'}>{signedIn ? __msg("Dashboard") : __msg("Log in")}</Link><Link className={s.primaryButton} to={startUrl}>{signedIn ? __msg("Open workspace") : __msg("Get started")}<ArrowUpRight size={16} /></Link><button className={s.menuButton} aria-label={menuOpen ? __msg("Close menu") : __msg("Open menu")} aria-expanded={menuOpen} aria-controls="landing-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button></div>
    </div></header>
    <main id="landing-main">
      <section className={s.hero} aria-labelledby="hero-title"><div className={s.heroGlow} aria-hidden="true" /><div className={s.heroContent}>
        <span className={s.eyebrow}><span className={s.liveDot} />{" "}{__msg("A shared space for language & discovery")}</span>
        <h1 id="hero-title">{__msg("Language is full")}<br />{__msg("of")}{" "}<span>{__msg("possibility.")}</span></h1>
        <p>{__msg("Bring your ideas, your data, and your people.")}<br className={s.desktopBreak} />{" "}{__msg("Build something meaningful with NLP.")}</p>
        <div className={s.heroActions}><Link to={startUrl} className={s.primaryButton}>{__msg("Find your starting point")}{" "}<ArrowUpRight size={18} /></Link><a href="#workflow" className={s.secondaryButton}>{__msg("Explore the workflow")}{" "}<ArrowDown size={17} /></a></div>
        <div className={s.heroFootnote}><span>{__msg("Collect.")}</span><span>{__msg("Annotate.")}</span><span>{__msg("Experiment.")}</span><span>{__msg("Compete.")}</span></div>
      </div><a href="#platform" className={s.scrollHint}><span>{__msg("THERE’S MORE TO EXPLORE")}</span><ArrowDown size={16} /></a>
      <div className={`${s.orbitTag} ${s.tagOne}`} aria-hidden="true"><MessageSquare size={16} />{" "}{__msg("Text into insight")}</div><div className={`${s.orbitTag} ${s.tagTwo}`} aria-hidden="true"><Mic size={16} />{" "}{__msg("Voices into possibilities")}</div></section>

      <section id="platform" className={s.platformSection} aria-labelledby="platform-title">
        <div className={s.sectionIntro} data-reveal><span className={s.eyebrow}>{__msg("LESS FRICTION. MORE EXPLORATION.")}</span><h2 id="platform-title">{__msg("Big ideas need")}<br />{__msg("a little room to grow.")}</h2><p>{__msg("From the first dataset to the final submission,")}<br className={s.desktopBreak} />{" "}{__msg("keep your team’s next discovery in one place.")}</p></div>
        <div className={s.overview} data-reveal>
          <div className={s.overviewSidebar}><Wordmark /><span className={s.workspaceCaption}>{__msg("YOUR WORKSPACE")}</span><span className={s.sideSelected}><Layers3 size={16} />{" "}{__msg("Overview")}</span><span><Trophy size={16} />{" "}{__msg("Competitions")}</span><span><Database size={16} />{" "}{__msg("Datasets")}</span><span><FlaskConical size={16} />{" "}{__msg("Experiments")}</span><div className={s.sidebarBottom}><span className={s.teamAvatar}>NL</span><span>{__msg("NLP collective")}<small>{__msg("Ideas work better together.")}</small></span></div></div>
          <div className={s.overviewMain}><div className={s.overviewTop}><span>{__msg("Workspace / Overview")}</span><span className={s.demoLabel}>{__msg("ILLUSTRATIVE WORKSPACE")}</span></div><div className={s.overviewWelcome}><div><span className={s.fieldLabel}>{__msg("A LITTLE CURIOSITY GOES A LONG WAY")}</span><h3>{__msg("Your next discovery starts here.")}</h3></div><span className={s.overviewSpark}><Sparkles size={23} /></span></div>
            <div className={s.overviewMetrics}>{[[Database, 'Collect & curate', 'Give your ideas a foundation.'], [CheckCheck, 'Annotate & review', 'Bring meaning to every sample.'], [Trophy, 'Submit & discover', 'See how your ideas perform.']].map(([Icon, title, text]) => <div key={title}><span className={s.metricIcon}><Icon size={18} /></span><strong>{__msg(title)}</strong><p>{__msg(text)}</p></div>)}</div>
            <div className={s.overviewBottom}><div className={s.overviewChart}><div className={s.visualHeading}><strong>{__msg("Every experiment is a step forward.")}</strong><span className={s.subtle}>{__msg("Example progress")}</span></div><LineChart compact /></div><div className={s.overviewNote}><span className={s.smallEyebrow}>{__msg("BUILT FOR COLLABORATION")}</span><Avatars /><h4>{__msg("Better questions.")}<br />{__msg("Shared discoveries.")}</h4><p>{__msg("A place for your team’s different perspectives.")}</p></div></div>
          </div>
        </div><div className={s.audienceLine}><span>{__msg("For curious minds and ambitious teams.")}</span><span>{__msg("Students")}{" "}<i />{" "}{__msg("Researchers")}{" "}<i />{" "}{__msg("Competition organizers")}</span></div>
      </section>

      <section id="workflow" className={s.workflow} aria-labelledby="workflow-title"><div className={s.workflowGrid}>
        <div className={s.workflowSticky}><span className={s.eyebrow}>{__msg("FROM A QUESTION TO WHAT’S NEXT")}</span><h2 id="workflow-title">{__msg("Your ideas.")}<br />{__msg("A connected")}<br /><span>{__msg("journey.")}</span></h2><p>{__msg("One place for every part of your NLP competition. Follow the possibilities, one step at a time.")}</p>
          <div className={s.stageNav} aria-label={__msg("Workflow stages")}>{stages.map((stage, index) => <button key={stage.short} className={activeStage === index ? s.activeStage : ''} onClick={() => goToStage(index)} aria-current={activeStage === index ? 'step' : undefined}><span className={s.stageNumber}>0{index + 1}</span><span>{__msg(stage.short)}</span><ArrowUpRight size={16} /><span className={s.stageProgress} /></button>)}</div><span className={s.workflowHint}><ArrowDown size={14} />{" "}{__msg("Scroll to follow the journey")}</span>
        </div>
        <div className={s.workflowPanels}>{stages.map((stage, index) => <article className={`${s.stagePanel} ${activeStage === index ? s.panelActive : ''}`} key={stage.short} ref={element => { panels.current[index] = element }} aria-labelledby={`stage-title-${index}`}><div className={s.stageCaption}><span>0{index + 1} / {__msg("THE WORKFLOW")}</span><stage.icon size={21} /></div><h3 id={`stage-title-${index}`}>{__msg(stage.title)}</h3><p>{__msg(stage.text)}</p><StageVisual index={index} /><span className={s.visualDisclaimer}>{__msg("Illustrative preview · Sample content and results")}</span></article>)}</div>
      </div></section>

      <section id="possibilities" className={s.possibilities} aria-labelledby="possibilities-title">
        <div className={s.possibilitiesHeader} data-reveal><span className={s.eyebrow}>{__msg("SMALL QUESTIONS. OPEN POSSIBILITIES.")}</span><h2 id="possibilities-title">{__msg("What will you")}<br />{__msg("make sense of next?")}</h2><p>{__msg("Explore the language problems that spark your curiosity.")}</p></div>
        <div className={s.taskGrid} data-reveal>{[[MessageSquare, 'Make sense of text.', 'Explore sentiment, classify documents, and discover the meaning behind the words.', ['Sentiment analysis', 'Text classification', 'Named entities'], s.textTask], [Mic, 'Give every voice a place.', 'Turn speech into something you can explore, annotate, and learn from together.', ['Speech recognition', 'Audio annotation'], s.voiceTask], [Sparkles, 'Connect ideas across language.', 'Explore how models translate, summarize, and answer the questions that matter.', ['Translation', 'Summarization', 'Question answering'], s.languageTask]].map(([Icon, title, text, tags, color]) => <article className={`${s.taskCard} ${color}`} key={title}><div className={s.taskArtwork} aria-hidden="true"><Icon size={50} strokeWidth={1.3} /><span /><span /></div><h3>{__msg(title)}</h3><p>{__msg(text)}</p><div className={s.taskTags}>{tags.map(tag => <span key={tag}>{tag}</span>)}</div></article>)}</div>
      </section>

      <section id="progress" className={s.progressSection} aria-labelledby="progress-title" data-reveal>
        <div className={s.progressCopy}><span className={s.eyebrow}>{__msg("A CLEARER VIEW OF YOUR PROGRESS")}</span><h2 id="progress-title">{__msg("Every iteration")}<br />{__msg("opens a new door.")}</h2><p>{__msg("Follow your experiments, compare your results, and see your work take shape.")}</p><div className={s.realMetrics}><div><strong>04</strong><span>{__msg("Connected workflow stages")}</span></div><div><strong>07</strong><span>{__msg("NLP task families to explore")}</span></div><div><strong>01</strong><span>{__msg("Shared space for your team")}</span></div></div></div>
        <div className={s.progressChart}><div className={s.progressChartHeader}><span><i />{" "}{__msg("MODEL PROGRESS")}</span><span>{__msg("Illustrative data")}</span></div><div className={s.bigScore}>0.94<span>Macro F1-score</span></div><LineChart /><div className={s.chartFooter}><span>{__msg("Explore. Learn. Improve. Repeat.")}</span><ArrowUpRight size={18} /></div></div>
      </section>
      <section className={s.finalCta} data-reveal><span className={s.eyebrow}>{__msg("MAKE SPACE FOR YOUR NEXT IDEA")}</span><h2>{__msg("A little curiosity.")}<br /><span>{__msg("A world of possibility.")}</span></h2><p>{__msg("Your next NLP project starts with a first step.")}</p><Link className={s.primaryButton} to={startUrl}>{__msg("Let’s get started")}{" "}<ArrowUpRight size={18} /></Link></section>
    </main>
    <footer className={s.footer}><div className={s.footerTop}><div><a href="#landing-top" className={s.brand} aria-label={__msg("Lexivia home")}><Wordmark /></a><p>{__msg("Where language meets possibility.")}</p></div><nav aria-label={__msg("Footer navigation")}><a href="#platform">{__msg("The platform")}</a><a href="#workflow">{__msg("How it works")}</a><a href="#possibilities">{__msg("Possibilities")}</a><Link to={startUrl}>{__msg("Join Lexivia")}{" "}<ChevronRight size={15} /></Link></nav></div><div className={s.footerBottom}><span>© {new Date().getFullYear()} Lexivia</span><span>{__msg("Built for curious minds. Better together.")}</span></div></footer>
  </div>
}
