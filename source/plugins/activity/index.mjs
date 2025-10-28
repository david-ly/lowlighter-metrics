import {processEvent} from './process-event.js'

const LOG_PREFIX = (login) => `metrics/compute/${login}/plugins > activity`

//Setup
export default async function({login, data, rest, q, account, imports}, {enabled = false, markdown = "inline", extras = false} = {}) {
  //Plugin execution
  try {
    if ((!q.activity)
      || (!imports.metadata.plugins.activity.enabled(enabled, {extras})))
      return null

    let context = {mode: "user"}
    if (q.repo) { // remap data {(repo) name, owner.login} -> {repo, owner}
      console.debug(`${LOG_PREFIX(login)} > switched to repository mode`)
      const {user: {repositories: {nodes}}} = data
      console.dir({nodes})
      nodes.map(({name: repo, owner: {login: owner}}) => ({repo, owner}))
      const {owner, repo} = nodes.shift()
      context = {...context, mode: "repository", owner, repo}
    }

    //Load inputs
    let {
      days = Infinity
    , filter
    , ignored
    , limit
    , load
    , skipped
    , timestamps
    , visibility
    } = imports.metadata.plugins.activity.inputs({account, data, q})
    skipped.push(...data.shared["repositories.skipped"])
    ignored.push(...data.shared["users.ignored"])
    const pages = Math.ceil(load / 100)
    const codelines = 2

    //Get user recent activity
    console.debug(`${LOG_PREFIX(login)} > querying api`)
    const {owner, repo} = context
    const opts = {username: login, per_page: 100}
    const events = []
    try {
      for (let page = 1; page <= pages; page++) {
        console.debug(`${LOG_PREFIX(login)} > loading page ${page}/${pages}`)
        const event = context.mode === 'repository'
          ? await rest.activity.listRepoEvents({owner, repo})
          : await rest.activity.listEventsForAuthenticatedUser({...opts, page})
        events.push(...event.data)
      }
    } catch {
      console.debug(`${LOG_PREFIX(login)} > no more page to load`)
    }
    console.debug(`${LOG_PREFIX(login)} > ${events.length} events loaded`)

    //Extract activity events
    let filtered = events.filter(({actor}) => {
      if (account === 'organization') return true
      return actor.login?.toLocaleLowerCase() === login.toLocaleLowerCase()
    })
    console.debug(`${LOG_PREFIX(login)} > events (actor): ${filtered.length}`)
    // filtered = filtered.filter(({created_at}) => Number.isFinite(days) ? new Date(created_at) > new Date(Date.now() - days * 24 * 60 * 60 * 1000) : true)
    // console.debug(`${LOG_PREFIX(login)} > after date filter: ${filtered.length} events`)
    filtered = filtered.filter((event) => {
      return visibility === "public" ? event.public : true
    })
    console.debug(`${LOG_PREFIX(login)} > events (vis): ${filtered.length}`)

    // const processed_events = filtered.map(event => processEvent({event, ctx}))
    // const activity = await Promise.all(processed_events)
    const activity = (await Promise.all(
      filtered
        .map(async ({type, payload, actor: {login: actor}, repo: {name: repo}, created_at}) => {
          //See https://docs.github.com/en/free-pro-team@latest/developers/webhooks-and-events/github-event-types
          const timestamp = new Date(created_at)
          if (!imports.filters.repo(repo, skipped))
            return null
          switch (type) {
            //Commented on a commit
            case "CommitCommentEvent": {
              if (!["created"].includes(payload.action))
                return null
              const {comment: {user: {login: user}, commit_id: sha, body: content}} = payload
              if (!imports.filters.text(user, ignored))
                return null
              return {type: "comment", on: "commit", actor, timestamp, repo, content: await imports.markdown(content, {mode: markdown, codelines}), user, mobile: null, number: sha.substring(0, 7), title: ""}
            }
            //Created a git branch or tag
            case "CreateEvent": {
              const {ref: name, ref_type: type} = payload
              return {type: "ref/create", actor, timestamp, repo, ref: {name, type}}
            }
            //Deleted a git branch or tag
            case "DeleteEvent": {
              const {ref: name, ref_type: type} = payload
              return {type: "ref/delete", actor, timestamp, repo, ref: {name, type}}
            }
            //Forked repository
            case "ForkEvent": {
              const {forkee: {full_name: forked}} = payload
              return {type: "fork", actor, timestamp, repo, forked}
            }
            //Wiki changes
            case "GollumEvent": {
              const {pages} = payload
              return {type: "wiki", actor, timestamp, repo, pages: pages.map(({title}) => title)}
            }
            //Commented on an issue
            case "IssueCommentEvent": {
              if (!["created"].includes(payload.action))
                return null
              const {issue: {user: {login: user}, title, number}, comment: {body: content, performed_via_github_app: mobile}} = payload
              if (!imports.filters.text(user, ignored))
                return null
              return {type: "comment", on: "issue", actor, timestamp, repo, content: await imports.markdown(content, {mode: markdown, codelines}), user, mobile, number, title}
            }
            //Issue event
            case "IssuesEvent": {
              if (!["opened", "closed", "reopened"].includes(payload.action))
                return null
              const {action, issue: {user: {login: user}, title, number, body: content}} = payload
              if (!imports.filters.text(user, ignored))
                return null
              return {type: "issue", actor, timestamp, repo, action, user, number, title, content: await imports.markdown(content, {mode: markdown, codelines})}
            }
            //Activity from repository collaborators
            case "MemberEvent": {
              if (!["added"].includes(payload.action))
                return null
              const {member: {login: user}} = payload
              if (!imports.filters.text(user, ignored))
                return null
              return {type: "member", actor, timestamp, repo, user}
            }
            //Made repository public
            case "PublicEvent": {
              return {type: "public", actor, timestamp, repo}
            }
            //PR Events—GET /repos/{owner}/{repo}/pulls/{pull_number}
            case "PullRequestEvent": {
              if (!["opened", "closed"].includes(payload.action))
                return null
              // console.debug('PullRequestEvent')
              // console.dir({payload}, {depth: null})
              const {
                action
              , pull_request: {
                  // user: {login: user}
                // , title
                  number
                // , body: content, additions: added, deletions: deleted, changed_files: changed, merged
                , url
                }
              } = payload
              const {data} = await rest.pulls.get({
                owner: actor
              , repo: repo.split('/')[1]
              , pull_number: number
              })
              const {
                additions: added
              , body: content
              , changed_files: changed
              , deletions: deleted
              , merged
              , title
              , user: {login: user}
              } = data
              if (!imports.filters.text(user, ignored)) return null

              return {
                action: (action === "closed") && (merged) ? "merged" : action
              , actor
              , content: await imports.markdown(content, {mode: markdown, codelines})
              , files: {changed}
              , lines: {added, deleted}
              , number
              , repo
              , timestamp
              , title
              , type: "pr"
              , user
              }
            }
            //Reviewed a pull request
            case "PullRequestReviewEvent": {
              const {review, pull_request} = payload
              const {user: {login: user}, state} = review
              const {number} = pull_request

              // const {
              //   review: {state}
              // , pull_request: {user: {login: user}, number, title}
              // } = payload
              if (!imports.filters.text(user, ignored)) return null
              return {type: "review", actor, timestamp, repo, state, user, number, title: null}
            }
            //Commented on a pull request
            case "PullRequestReviewCommentEvent": {
              if (!["created"].includes(payload.action)) return null

              const {
                pull_request: { number }
              , comment: {
                  body: content
                , user: {login: user}
                }
              } = payload
              if (!imports.filters.text(user, ignored)) return null
              return {type: "comment", on: "pr", actor, timestamp, repo, content: await imports.markdown(content, {mode: markdown, codelines}), user, mobile: null, number, title: null}
            }
            //Pushed commits
            case "PushEvent": {
              let {ref, head: sha} = payload
              const lookback = 30 * 24 * 60 * 60 * 1000 // 30 days
              const {data} = await rest.repos.listCommits({
                owner: actor
              , repo: repo.split('/')[1]
              , sha
              , since: new Date(Date.now() - lookback).toISOString()
              })
              console.dir({data}, {depth: null})

              const commits = []
              for (const {commit, sha} of data) {
                const {author: {email}, message} = commit
                if (!imports.filters.text(email, ignored)) continue
                if (message.startsWith('Merge branch ')) continue

                commits.push({sha: sha.substring(0, 7), message})
              }
              console.dir({commits}, {depth: null})
              if (!commits.length) return null

              const matched = ref.match(/refs.heads.(?<branch>.*)/)
              const branch = matched?.groups?.branch ?? null
              console.dir({matched, branch})
              return {
                type: "push"
              , actor
              , timestamp
              , repo
              , size: commits.length
              , branch
              , commits: commits.reverse().map(({sha, message}) => ({sha: sha.substring(0, 7), message}))
              }
            }
            //Released
            case "ReleaseEvent": {
              if (!["published"].includes(payload.action))
                return null
              const {action, release: {name, tag_name, prerelease, draft, body: content}} = payload
              return {type: "release", actor, timestamp, repo, action, name: name || tag_name, prerelease, draft, content: await imports.markdown(content, {mode: markdown, codelines})}
            }
            //Starred a repository
            case "WatchEvent": {
              if (!["started"].includes(payload.action))
                return null
              const {action} = payload
              return {type: "star", actor, timestamp, repo, action}
            }
            //Unknown event
            default: {
              return null
            }
          }
        }),
    ))
    let ret_activity = activity.filter(event => event)
    ret_activity = ret_activity.filter(event => filter.includes("all") || filter.includes(event.type))
    console.debug(`${LOG_PREFIX(login)} > after filter type: ${ret_activity.length} events`)
    ret_activity = ret_activity.slice(0, limit)
    console.debug(`${LOG_PREFIX(login)} > final count after limit: ${ret_activity.length} events`)

    return {timestamps, events: ret_activity}
  }
  catch (error) {
    throw imports.format.error(error)
  }
}
