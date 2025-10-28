

/**
 * @typedef {Object} EventProps
 * @property {string} actor
 * @property {string} repo
 * @property {Date} timestamp
 */

/**
 * @typedef {Object} ProcessingOpts
 * @property {number} codelines
 * @property {string[]} ignored
 * @property {Object} imports
 * @property {string} markdown
 */

export async function processEvent(event, ctx) {
  const {
    actor: {login: actor}
  , created_at
  , payload
  , repo: {name: repo}
  , type
  } = event
  const {codelines, ignored, imports, markdown, skipped} = ctx
  if (!imports.filters.repo(repo, skipped)) return null

  const timestamp = new Date(created_at)
  /** @type {EventProps} */
  const event_props = {actor, repo, timestamp}
  switch (type) {
    case 'CommitCommentEvent': {
      /** @type {ProcessingOpts} */
      const opts = {codelines, ignored, imports, markdown}
      return handleCommitComment(payload, opts, event_props)
    }
    case 'CreateEvent': return handleRef(payload, 'create', event_props)
    case 'DeleteEvent': return handleRef(payload, 'delete', event_props)
    case 'ForkEvent': return handleFork(payload, event_props)
    case 'GollumEvent': return handleGollum(payload, event_props)
    case 'IssueCommentEvent': {
      /** @type {ProcessingOpts} */
      const opts = {codelines, ignored, imports, markdown}
      return handleIssueComment(payload, opts, event_props)
    }
    case 'IssuesEvent': {
      /** @type {ProcessingOpts} */
      const opts = {codelines, ignored, imports, markdown}
      return handleIssues(payload, opts, event_props)
    }
    case 'PullRequestEvent': return handlePr(payload)
    case 'PullRequestReviewEvent': return handlePrReview(payload)
    case 'PullRequestReviewCommentEvent': return handlePrReviewComment(payload)
    default: return null
  }
}

/**
 * @param {any} payload
 * @param {ProcessingOpts} opts
 * @param {EventProps} event_props
 */
async function handleCommitComment(payload, opts, event_props) {
  const {
    action
  , comment: {
      body
    , commit_id: sha
    , user: {login: user}
    }
  } = payload
  const {codelines, markdown, ignored, imports} = opts

  if (!['created'].includes(action)) return null
  if (!imports.filters.text(user, ignored)) return null
  return {
    ...event_props
  , content: await imports.markdown(body, {mode: markdown, codelines})
  , mobile: null
  , number: sha.substring(0, 7)
  , on: 'commit'
  , title: ''
  , type: 'comment'
  , user
  }
}

/**
 * @param {any} payload
 * @param {string} event_type
 * @param {EventProps} event_props
 */
function handleRef(payload, event_type, event_props) {
  const ref = {name: payload.ref, type: payload.ref_type}
  const type = `ref/${event_type}`
  return {
    ...event_props
  , ref
  , type
  }
}

/**
 * @param {any} payload
 * @param {EventProps} event_props
 */
function handleFork(payload, event_props) {
  const {forkee: {full_name: forked}} = payload
  const type = 'fork'
  return {...event_props, forked, type}
}

/**
 * @param {any} payload
 * @param {EventProps} event_props
 */
function handleGollum(payload, event_props) {
  const pages = payload.pages.map(({title}) => title)
  const type = 'wiki'
  return {...event_props, pages, type}
}

/**
 * @param {any} payload
 * @param {ProcessingOpts} opts
 * @param {EventProps} event_props
 */
async function handleIssueComment(payload, opts, event_props) {
  const {
    action
  , issue: {
      body
    , number
    , title
    , user: {login: user}
    }
  } = payload
  const {codelines, ignored, imports, markdown} = opts

  if (!['created'].includes(action)) return null
  if (!imports.filters.text(user, ignored)) return null
  return {
    ...event_props
  , action
  , content: await imports.markdown(body, {mode: markdown, codelines})
  , number
  , title
  , user
  }
}

/**
 * @param {any} payload
 * @param {ProcessingOpts} opts
 * @param {EventProps} event_props
 */
async function handleIssues(payload, opts, event_props) {
  const {
    action
  , issue: {
      body
    , number
    , title
    , user: {login: user}
    }
  } = payload
  const {codelines, ignored, imports, markdown} = opts

  if (!['opened', 'closed', 'reopened'].includes(action)) return null
  if (!imports.filters.text(user, ignored)) return null
  return {
    ...event_props
  , action
  , content: await imports.markdown(body, {mode: markdown, codelines})
  , number
  , title
  , user
  }
}

function handleMember(payload, event_props) {
  const {
    action
  , member: {login: user}
  } = payload

  if (!['added'].includes(action)) return null
  if (!imports.filters.text(user, ignored)) return null
  return {
    ...event_props
  , action
  , user
  }
}

function handlePr(payload, opts, event_props) {
  const {
    action
  , pull_request: {number, url}
  } = payload
  const {codelines, ignored, imports, markdown} = opts
  const url_obj = new URL(url)
  const user = url_obj.pathname.split('/')?.[2]


  if (!['opened', 'closed'].includes(action)) return null
  if (!imports.filters.text(user, ignored)) return null

  const final_action = (action === 'closed' && !!merged) ? 'merged' : action
  return {...event_props, action: final_action, number, type: 'pr', user}
}
