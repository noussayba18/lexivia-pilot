import { t as __msg, useLanguage as useInterfaceLanguage } from '../i18n/index.js';
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, ChevronDown, FileText, Grid2X2, Languages, Layers3, List, LoaderCircle, MessageSquare, Mic, Pencil, Plus, Search, SlidersHorizontal, Tags, Trophy, Users, X } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
// These shell styles are also used by existing workspace pages.
import '../styles/Competitions.css'
import s from '../styles/competitionDiscovery.module.css'

const API = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const PAGE_SIZE = 10
const ALL_TASKS = 'ALL TASKS'
const TASK_FILTER_KEY = 'competitions_taskType'
const SORT_OPTIONS = [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['unknown_dates', 'Unknown dates only']]
const MEMBERSHIP_OPTIONS = [['all', 'All competitions'], ['participating', 'Participating'], ['organizing', 'Organizing']]
const TASKS = {
  GENERAL: { Icon: Trophy, tone: 'teal', copy: 'Explore something new.' },
  TRANSCRIPTION: { Icon: Mic, tone: 'coral', copy: 'Give every voice a place.' },
  CLASSIFICATION: { Icon: Tags, tone: 'teal', copy: 'Find meaning in the words.' },
  SPAN_ANNOTATION: { Icon: BarChart3, tone: 'teal', copy: 'Bring the details into focus.' },
  TRANSLATION: { Icon: Languages, tone: 'gold', copy: 'Connect across languages.' },
  SUMMARIZATION: { Icon: FileText, tone: 'ink', copy: 'Make room for the essentials.' },
  QUESTION_ANSWERING: { Icon: MessageSquare, tone: 'gold', copy: 'Follow a good question.' },
  FREE_TEXT: { Icon: Pencil, tone: 'coral', copy: 'Explore an open possibility.' },
}

function prettyTaskType(type) {
  const text = String(type || '').replace(/_/g, ' ').toLowerCase()
  return __msg(text.charAt(0).toUpperCase() + text.slice(1))
}
function taskInfo(type) { return TASKS[String(type || 'GENERAL').trim().toUpperCase().replace(/[\s-]+/g, '_')] || TASKS.GENERAL }
function normalizeStatus(status) { return String(status || '').trim().toUpperCase() }
function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase()
  return ['organizer', 'participant'].includes(value) ? value : 'none'
}

function cardAction(item) {
  // Organizers keep their management destination for every competition state.
  if (normalizeRole(item.user_role) === 'organizer') return { label: 'Manage', href: `/competitions/${item.id}/organizer` }
  if (normalizeStatus(item.status) !== 'OPEN') return { label: 'View details', href: `/competitions/${item.id}` }
  if (normalizeRole(item.user_role) === 'participant') return { label: 'Contribute', href: `/competitions/${item.id}/data-collection` }
  return { label: 'View challenge', href: `/competitions/${item.id}` }
}

function StatusChip({ status }) {
  useInterfaceLanguage();
  const key = normalizeStatus(status)
  const labels = { OPEN: 'Open', CLOSED: 'Ended', ENDED: 'Ended', UPCOMING: 'Upcoming', DRAFT: 'Draft' }
  return <span className={`${s.status} ${s[key.toLowerCase()] || s.closed}`}><i />{__msg(labels[key] || "Status unavailable")}</span>
}

function RoleChip({ role }) {
  useInterfaceLanguage();
  const key = normalizeRole(role)
  return key === 'none' ? null : <span className={`${s.role} ${s[key]}`}>{key === 'organizer' ? __msg("Organizing") : __msg("Participating")}</span>
}

function displayStat(value, label) {
  if (value == null || value === '' || value === 'TBD') return 'To be announced'
  if (String(label).toUpperCase() === 'DEADLINE' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T12:00:00`)
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString(document.documentElement.lang, { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return String(value)
}

function CompetitionCard({ item, labelOfTaskType }) {
  useInterfaceLanguage();
  const types = Array.isArray(item.task_types) ? [...new Set(item.task_types)] : []
  const { Icon, tone } = taskInfo(types[0])
  const action = cardAction(item)
  const detailHref = normalizeRole(item.user_role) === 'organizer' ? action.href : `/competitions/${item.id}`
  return <article className={s.card}>
    <div className={`${s.cover} ${s[`cover_${tone}`]}`}><div className={s.coverArt} aria-hidden="true"><span className={s.coverOrbit} /><span className={s.coverOrbitTwo} /><span className={s.coverDot} /><span className={s.coverIcon}><Icon size={40} strokeWidth={1.25} /></span><span className={s.coverLines}><i /><i /><i /><i /><i /></span></div><span className={s.coverType}>{types.length ? labelOfTaskType(types[0]) : __msg("A new possibility")}</span><StatusChip status={item.status} /></div>
    <div className={s.cardContent}><div className={s.cardKicker}><span><Trophy size={12} />{" "}{__msg("Competition")}</span><RoleChip role={item.user_role} /></div><h3><Link to={detailHref}>{item.title}</Link></h3><p className={s.description}>{item.description || __msg("Explore the challenge details and requirements from the organizer.")}</p>
      <div className={s.taskLabels} title={types.map(labelOfTaskType).join(', ')}>{(types.length ? types.slice(0, 2) : ['GENERAL']).map(type => <span key={type}>{type === 'GENERAL' ? __msg("General") : labelOfTaskType(type)}</span>)}{types.length > 2 && <span>+{types.length - 2}{" "}{__msg("more")}</span>}</div>
      <dl className={s.cardStats}><div><dt>{__msg(item.stat1_label || "Reward")}</dt><dd>{__msg(displayStat(item.stat1_value, item.stat1_label))}</dd></div><div><dt>{__msg(item.stat2_label || "Deadline")}</dt><dd>{__msg(displayStat(item.stat2_value, item.stat2_label))}</dd></div></dl>
      <div className={s.cardFooter}><span><Layers3 size={12} />{types.length ? __msg("{value0} {value1} to explore", {value0: types.length, value1: types.length === 1 ? __msg("task") : __msg("tasks")}) : __msg("General challenge")}</span><Link className={s.primaryButton} to={action.href}>{__msg(action.label)}<ArrowUpRight size={14} /></Link></div>
    </div>
  </article>
}

export default function Competitions() {
  const navigate = useNavigate()
  const location = useLocation()
  const search = new URLSearchParams(location.search).get('search') || ''
  const token = localStorage.getItem('token')
  const authHeaders = useMemo(() => token ? { Authorization: `Bearer ${token}` } : {}, [token])
  const [sortOrder, setSortOrder] = useState(() => SORT_OPTIONS.some(([value]) => value === localStorage.getItem('competitions_sortOrder')) ? localStorage.getItem('competitions_sortOrder') : 'newest')
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('competitions_viewMode') === 'list' ? 'list' : 'grid')
  const [taskType, setTaskType] = useState(() => localStorage.getItem(TASK_FILTER_KEY) || ALL_TASKS)
  const [taskTypeOptions, setTaskTypeOptions] = useState([])
  const [filtersReady, setFiltersReady] = useState(() => (localStorage.getItem(TASK_FILTER_KEY) || ALL_TASKS) === ALL_TASKS)
  const [competitions, setCompetitions] = useState([])
  const [searchInput, setSearchInput] = useState(search)
  const [tab, setTab] = useState('all')
  const [offset, setOffset] = useState(0)
  const [totalCount, setTotalCount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => { if (!token) navigate('/login', { replace: true }) }, [token, navigate])
  useEffect(() => {
    window.scrollTo(0, 0)
    const previous = document.title
    document.title = 'Competitions — Lexivia'
    return () => { document.title = previous }
  }, [])

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    fetch(`${API}/competition-schema`, { headers: authHeaders, signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(schema => {
        if (controller.signal.aborted) return
        const options = Array.isArray(schema?.task_types) ? schema.task_types.map(task => ({ value: task.value, label: task.label })) : []
        setTaskTypeOptions(options)
        setTaskType(current => {
          if (current === ALL_TASKS || options.some(option => option.value === current)) return current
          localStorage.setItem(TASK_FILTER_KEY, ALL_TASKS)
          return ALL_TASKS
        })
      })
      .catch(() => { if (!controller.signal.aborted) { setTaskTypeOptions([]); setTaskType(ALL_TASKS) } })
      .finally(() => { if (!controller.signal.aborted) setFiltersReady(true) })
    return () => controller.abort()
  }, [token, authHeaders])

  const labelOfTaskType = useMemo(() => {
    const labels = Object.fromEntries(taskTypeOptions.map(option => [option.value, option.label]))
    return type => __msg(labels[type] || prettyTaskType(type))
  }, [taskTypeOptions])

  useEffect(() => { setSearchInput(search); setOffset(0) }, [search])
  useEffect(() => {
    if (!location.state?.refreshAll) return
    setTaskType(ALL_TASKS); setTab('all'); setSearchInput(''); setViewMode('grid'); setOffset(0); setSortOrder('newest')
    localStorage.setItem(TASK_FILTER_KEY, ALL_TASKS)
    localStorage.setItem('competitions_sortOrder', 'newest')
    localStorage.setItem('competitions_viewMode', 'grid')
    navigate(location.pathname, { replace: true, state: {} })
  }, [location, navigate])

  useEffect(() => {
    if (!token) return
    const timer = window.setTimeout(() => {
      const clean = searchInput.trim()
      if (clean === search) return
      setOffset(0)
      navigate(clean ? `/competitions?search=${encodeURIComponent(clean)}` : '/competitions', { replace: true })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [searchInput, search, token, navigate])

  useEffect(() => {
    if (!token || !filtersReady) return
    const controller = new AbortController()
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), tab, sort: sortOrder })
    if (search) params.set('search', search)
    if (taskType !== ALL_TASKS) params.set('task_type', taskType)
    setLoading(true); setError('')
    fetch(`${API}/competitions?${params}`, { headers: authHeaders, signal: controller.signal })
      .then(response => {
        if (controller.signal.aborted) return null
        if (response.status === 401) { navigate('/login', { replace: true }); return null }
        if (!response.ok) throw new Error('Unable to load competitions. Please try again.')
        return response.json()
      })
      .then(items => {
        if (controller.signal.aborted || items === null) return
        if (!Array.isArray(items)) throw new Error('The competitions response was incomplete. Please try again.')
        setHasMore(items.length === PAGE_SIZE)
        setCompetitions(previous => offset === 0 ? items : [...previous, ...items].filter((item, index, all) => index === all.findIndex(other => other.id === item.id)))
      })
      .catch(err => {
        if (controller.signal.aborted) return
        setError(err.message === 'Failed to fetch' ? 'We couldn’t reach the server. Check your connection and try again.' : err.message || 'Unable to load competitions. Please try again.')
        if (offset === 0) { setCompetitions([]); setHasMore(false) }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [token, authHeaders, filtersReady, search, taskType, tab, sortOrder, offset, retry, navigate])

  useEffect(() => {
    if (!token || !filtersReady) return
    const controller = new AbortController()
    const params = new URLSearchParams({ tab })
    if (search) params.set('search', search)
    if (taskType !== ALL_TASKS) params.set('task_type', taskType)
    setTotalCount(null)
    fetch(`${API}/competitions/count?${params}`, { headers: authHeaders, signal: controller.signal })
      .then(response => {
        if (response.status === 401) { navigate('/login', { replace: true }); return null }
        if (!response.ok) throw new Error('Count unavailable')
        return response.json()
      })
      .then(result => { if (!controller.signal.aborted && result) setTotalCount(Number.isFinite(Number(result.count)) ? Number(result.count) : null) })
      .catch(() => { if (!controller.signal.aborted) setTotalCount(null) })
    return () => controller.abort()
  }, [token, authHeaders, filtersReady, search, taskType, tab, retry, navigate])

  const changeTask = value => { setOffset(0); setTaskType(value); localStorage.setItem(TASK_FILTER_KEY, value) }
  const changeSort = value => { setOffset(0); setSortOrder(value); localStorage.setItem('competitions_sortOrder', value) }
  const changeTab = value => { setOffset(0); setTab(value) }
  const changeView = value => { setViewMode(value); localStorage.setItem('competitions_viewMode', value) }
  const reset = () => { changeTask(ALL_TASKS); changeSort('newest'); changeTab('all'); setSearchInput(''); navigate('/competitions', { replace: true }) }
  const canLoadMore = totalCount === null ? hasMore : competitions.length < totalCount

  return <CompetitionsView model={{ competitions, searchInput, taskType, taskTypeOptions, tab, sortOrder, viewMode, loading, error, offset, totalCount, canLoadMore }} actions={{ onSearch: setSearchInput, onTask: changeTask, onSort: changeSort, onTab: changeTab, onView: changeView, onReset: reset, onRetry: () => setRetry(value => value + 1), onLoadMore: () => { if (!loading && canLoadMore) setOffset(value => value + PAGE_SIZE) } }} labelOfTaskType={labelOfTaskType} />
}

export function CompetitionsView({ model, actions, labelOfTaskType = prettyTaskType }) {
  useInterfaceLanguage();
  const { competitions, searchInput, taskType, taskTypeOptions, tab, sortOrder, viewMode, loading, error, offset, totalCount, canLoadMore } = model
  const { onSearch, onTask, onSort, onTab, onView, onReset, onRetry, onLoadMore } = actions
  const [filtersOpen, setFiltersOpen] = useState(false)
  const categoryStrip = useRef(null)
  const filterCount = Number(taskType !== ALL_TASKS) + Number(tab !== 'all') + Number(sortOrder !== 'newest')
  const filtered = filterCount > 0 || Boolean(searchInput.trim())
  const categories = [{ value: ALL_TASKS, label: 'All challenges', Icon: Layers3, copy: 'A world of possibilities.' }, ...taskTypeOptions.map(option => ({ ...option, ...taskInfo(option.value) }))]
  const scrollCategories = direction => categoryStrip.current?.scrollBy({ left: direction * 240, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  const heading = taskType !== ALL_TASKS ? labelOfTaskType(taskType) : tab === 'organizing' ? 'The challenges you’re shaping.' : tab === 'participating' ? 'The challenges you’re part of.' : 'Explore the possibilities.'

  return <div className={s.page}><Sidebar /><div className={s.main}><Topbar /><main className={s.body}>
    <header className={s.heading}><div><span className={s.eyebrow}>{__msg("COMPETITIONS · DISCOVER & CONTRIBUTE")}</span><h1>{__msg("Find your next challenge.")}</h1><p>{__msg("A good question. A different perspective. Something meaningful to build together.")}</p></div><Link className={s.primaryButton} to="/create-competition"><Plus size={16} />{" "}{__msg("Create competition")}</Link></header>
    <section className={s.discovery} aria-label={__msg("Find competitions")}><form className={s.searchBar} role="search" aria-label={__msg("Search competitions")} onSubmit={event => event.preventDefault()}><Search size={21} aria-hidden="true" /><input type="search" aria-label={__msg("Search competitions by title or description")} placeholder={__msg("What will you explore next?")} value={searchInput} onChange={event => onSearch(event.target.value)} />{searchInput && <button type="button" className={s.clearSearch} onClick={() => onSearch('')} aria-label={__msg("Clear competition search")}><X size={16} /></button>}<button type="button" className={`${s.filtersButton} ${filtersOpen ? s.filtersActive : ''}`} aria-label={__msg("Competition filters")} aria-expanded={filtersOpen} aria-controls="competition-refinements" onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={16} /><span>{__msg("Filters")}</span>{filterCount > 0 && <b>{filterCount}</b>}</button></form>
      {filtersOpen && <div className={s.refinements} id="competition-refinements"><div className={s.refinementHeading}><span>{__msg("Make it your kind of challenge.")}</span>{filtered && <button type="button" onClick={onReset}>{__msg("Reset all")}</button>}</div><div className={s.refinementGrid}><label>{__msg("Task type")}<select value={taskType} onChange={event => onTask(event.target.value)}><option value={ALL_TASKS}>{__msg("All task types")}</option>{taskTypeOptions.map(option => <option key={option.value} value={option.value}>{__msg(option.label)}</option>)}</select></label><label>{__msg("Your participation")}<select value={tab} onChange={event => onTab(event.target.value)}>{MEMBERSHIP_OPTIONS.map(([value, label]) => <option key={value} value={value}>{__msg(label)}</option>)}</select></label><label>{__msg("Sort by")}<select value={sortOrder} onChange={event => onSort(event.target.value)}>{SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{__msg(label)}</option>)}</select></label></div></div>}
      <div className={s.categoryHeading}><span className={s.eyebrow}>{__msg("FOLLOW YOUR CURIOSITY")}</span>{categories.length > 3 && <div><button type="button" onClick={() => scrollCategories(-1)} aria-label={__msg("Previous task categories")}><ArrowLeft size={14} /></button><button type="button" onClick={() => scrollCategories(1)} aria-label={__msg("More task categories")}><ArrowRight size={14} /></button></div>}</div>
      <div className={s.categories} ref={categoryStrip} aria-label={__msg("Filter competitions by task")}>{categories.map(({ value, label, Icon, copy }) => <button type="button" key={value} onClick={() => onTask(value)} aria-pressed={taskType === value} className={`${s.category} ${taskType === value ? s.categorySelected : ''}`}><span className={s.categoryTop}><strong>{__msg(label)}</strong><Icon size={18} strokeWidth={1.6} /></span><span className={s.categoryCopy}>{__msg(copy)}</span></button>)}</div>
    </section>
    <section className={s.results} aria-labelledby="competition-results-heading"><div className={s.resultsHeading}><div><span className={s.eyebrow}>{tab === 'all' ? __msg("A SPACE FOR YOUR NEXT IDEA") : __msg("YOUR COMPETITION WORKSPACE")}</span><h2 id="competition-results-heading">{__msg(heading)}</h2><p aria-live="polite">{loading && offset === 0 ? __msg("Finding your next possibility…") : error && competitions.length === 0 ? __msg("Your results are temporarily unavailable.") : totalCount === null ? __msg("{value0} {value1} loaded", {value0: competitions.length, value1: competitions.length === 1 ? __msg("competition") : __msg("competitions")}) : __msg("{value0} {value1} to explore", {value0: totalCount.toLocaleString(document.documentElement.lang), value1: totalCount === 1 ? __msg("competition") : __msg("competitions")})}</p></div><div className={s.viewToggle} aria-label={__msg("Competition layout")}><button type="button" aria-label={__msg("Grid view")} title={__msg("Grid view")} aria-pressed={viewMode === 'grid'} onClick={() => onView('grid')}><Grid2X2 size={16} /></button><button type="button" aria-label={__msg("List view")} title={__msg("List view")} aria-pressed={viewMode === 'list'} onClick={() => onView('list')}><List size={18} /></button></div></div>
      <div className={s.resultToolbar}><div className={s.membership} aria-label={__msg("Filter by your role")}>{MEMBERSHIP_OPTIONS.map(([value, label]) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => onTab(value)}>{value === 'participating' && <Users size={13} />}{value === 'organizing' && <Pencil size={13} />}{__msg(label)}</button>)}</div><button type="button" className={s.sortSummary} onClick={() => setFiltersOpen(true)} aria-label={__msg("Change competition sort order")}>{SORT_OPTIONS.find(([value]) => value === sortOrder)?.[1] || __msg("Newest first")}<ChevronDown size={13} /></button></div>
      {filtered && <div className={s.appliedFilters}>{taskType !== ALL_TASKS && <button type="button" onClick={() => onTask(ALL_TASKS)} aria-label={__msg("Remove {value0} task filter", {value0: labelOfTaskType(taskType)})}>{__msg(labelOfTaskType(taskType))}<X size={12} /></button>}{searchInput.trim() && <button type="button" onClick={() => onSearch('')} aria-label={__msg("Remove search filter")}>“{searchInput.trim()}”<X size={12} /></button>}<button type="button" className={s.resetFilters} onClick={onReset}>{__msg("Clear all filters")}</button></div>}
      {error && <div className={s.error} role="alert"><AlertCircle size={17} /><span>{__msg(error)}</span><button type="button" disabled={loading} onClick={onRetry}>{__msg("Try again")}<ArrowRight size={13} /></button></div>}
      <div aria-busy={loading}>
        {loading && offset === 0 ? <><span className={s.loadingMessage} role="status"><LoaderCircle size={15} className={s.spin} />{" "}{__msg("Gathering the challenges…")}</span><div className={s.grid} aria-hidden="true">{[0, 1, 2].map(index => <div className={s.skeleton} key={index}><span /><i /><i /><i /></div>)}</div></> : competitions.length > 0 ? <div className={viewMode === 'list' ? s.list : s.grid}>{competitions.map(item => <CompetitionCard key={item.id} item={item} labelOfTaskType={labelOfTaskType} />)}</div> : <div className={s.empty}>{error ? <AlertCircle size={30} strokeWidth={1.5} /> : <Search size={30} strokeWidth={1.4} />}<h3>{error ? __msg("A little pause in discovery.") : filtered ? __msg("A different search might spark something.") : __msg("The next great challenge could be yours.")}</h3><p>{error ? __msg("Try loading the competitions again in a moment.") : filtered ? __msg("Try another task, adjust your search, or clear your filters.") : __msg("There are no competitions to show just yet. Create one and bring a good question to life.")}</p>{!error && (filtered ? <button type="button" className={s.secondaryButton} onClick={onReset}>{__msg("Clear filters")}{" "}<ArrowRight size={14} /></button> : <Link className={s.primaryButton} to="/create-competition">{__msg("Create a competition")}{" "}<Plus size={15} /></Link>)}</div>}
      </div>
      {competitions.length > 0 && <div className={s.pagination}><span>{totalCount === null ? __msg("Showing {value0} competitions", {value0: competitions.length}) : __msg("Showing {value0} of {value1} competitions", {value0: competitions.length, value1: totalCount.toLocaleString(document.documentElement.lang)})}</span>{canLoadMore ? <button type="button" className={s.secondaryButton} disabled={loading} onClick={onLoadMore}>{loading ? <><LoaderCircle size={15} className={s.spin} />{" "}{__msg("Loading more…")}</> : <>{__msg("A little more to explore")}<ArrowDownIcon /></>}</button> : !loading && <span className={s.endNote}>{__msg("You’ve reached the end of these results.")}</span>}</div>}
    </section><footer className={s.footer}>{__msg("Different questions. Shared discoveries.")}</footer>
  </main></div></div>
}

function ArrowDownIcon() { return <ArrowRight size={14} style={{ transform: 'rotate(90deg)' }} /> }
