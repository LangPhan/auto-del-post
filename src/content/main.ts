// ─── Font Size Tool ───
const STORAGE_KEY = 'fb-feed-font-size'
const STYLE_ID = 'crxjs-fb-font-size'

function applyFontSize(size: number) {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null

  if (size === 100) {
    style?.remove()
    return
  }

  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }

  const zoom = size / 100
  style.textContent = `
    div[role="feed"] {
      zoom: ${zoom} !important;
    }
  `
}

chrome.storage.local.get(STORAGE_KEY).then((result) => {
  const size = result[STORAGE_KEY] as number | undefined
  if (size && size !== 100) {
    applyFontSize(size)
  }
})

chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY]) {
    const size = (changes[STORAGE_KEY].newValue as number) ?? 100
    applyFontSize(size)
  }
})

// ─── Facebook GraphQL Helpers ───
function getFBDTSG(): string | null {
  // 1. Try meta tags or specific global variables if they were exposed (not possible in isolated world, so search HTML)
  // 2. Search for common patterns in page source
  const html = document.documentElement.innerHTML

  // Pattern 1: ["token","..."] or "token":"..."
  const patterns = [
    /["']fb_dtsg["']\s*[:]\s*["']([^"']+)["']/,
    /["']DTSGInitialData["']\s*,\s*\[\]\s*,\s*\{\s*["']token["']\s*:\s*["']([^"']+)["']/,
    /["']token["']\s*:\s*["']([^"']+)["']\s*,\s*["']async_get_token["']/
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) return match[1]
  }

  // 3. Last resort: check any hidden input named fb_dtsg
  const input = document.querySelector('input[name="fb_dtsg"]') as HTMLInputElement
  return input?.value || null
}

function getUserID(): string | null {
  // 1. Try cookie
  const cookieMatch = document.cookie.match(/c_user=(\d+)/)
  if (cookieMatch?.[1]) return cookieMatch[1]

  // 2. Try page source patterns if cookie is inaccessible
  const html = document.documentElement.innerHTML
  const patterns = [
    /["']USER_ID["']\s*:\s*["'](\d+)["']/,
    /["']actorID["']\s*:\s*["'](\d+)["']/,
    /["']ACCOUNT_ID["']\s*:\s*["'](\d+)["']/
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    console.log("MATCH:  " + match);

    if (match?.[1]) return match[1]
  }

  return null
}

async function likePost(feedbackId: string): Promise<{ success: boolean; message: string }> {
  console.log('Attempting to like post:', feedbackId)
  const fb_dtsg = getFBDTSG()
  const av = getUserID()

  if (!fb_dtsg) {
    const error = 'Could not find security token (fb_dtsg). If you are on a restricted page, try refreshing.'
    sendLog(error, 'error')
    return { success: false, message: error }
  }

  if (!av) {
    const error = 'Could not find User ID. Make sure you are logged into Facebook.'
    sendLog(error, 'error')
    return { success: false, message: error }
  }

  try {
    const res = await fetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'av': av,
        '__user': av,
        '__a': '1',
        'fb_dtsg': fb_dtsg,
        'fb_api_caller_class': 'RelayModern',
        'fb_api_req_friendly_name': 'CometUFIFeedbackReactMutation',
        'variables': JSON.stringify({
          input: {
            attribution_id_v2: "CometGroupDiscussionRoot.react,comet.group,via_cold_start," + Date.now(),
            feedback_id: feedbackId,
            feedback_reaction_id: "1635855486666999", // Like reaction
            feedback_source: "PROFILE",
            is_tracking_encrypted: true,
            session_id: crypto.randomUUID(),
            actor_id: av,
            client_mutation_id: "1"
          },
          useDefaultActor: false,
          __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false
        }),
        'doc_id': '33371893662453814'
      })
    })

    const text = await res.text()
    if (text.includes('"errors"')) {
      const errorMsg = JSON.parse(text).errors[0].message
      sendLog(`Failed to like post: ${errorMsg}`, 'error')
      return { success: false, message: errorMsg }
    } else {
      const successMsg = 'Successfully liked post!'
      sendLog(successMsg, 'success')
      return { success: true, message: successMsg }
    }
  } catch (err) {
    const errorMsg = `Error liking post: ${err}`
    sendLog(errorMsg, 'error')
    return { success: false, message: errorMsg }
  }
}

async function apiDeletePost(storyId: string): Promise<{ success: boolean; message: string }> {
  const fb_dtsg = getFBDTSG()
  const av = getUserID()

  if (!fb_dtsg || !av) {
    return { success: false, message: 'Tokens missing (fb_dtsg or av)' }
  }

  console.log('API Deleting storyId:', storyId, 'with actor:', av)

  try {
    const res = await fetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'av': av,
        '__user': av,
        '__a': '1',
        'fb_dtsg': fb_dtsg,
        'fb_api_caller_class': 'RelayModern',
        'fb_api_req_friendly_name': 'useCometFeedStoryDeleteMutation',
        'variables': JSON.stringify({
          input: {
            story_id: storyId,
            story_location: "GROUP", // Switched from PERMALINK
            actor_id: av,
            client_mutation_id: Math.floor(Math.random() * 1000).toString()
          },
          groupID: null,
          inviteShortLinkKey: null,
          renderLocation: null,
          scale: 1,
          __relay_internal__pv__groups_comet_use_glvrelayprovider: false
        }),
        'doc_id': '33779779394969988'
      })
    })

    const text = await res.text()
    console.log('GraphQL Response:', text)

    if (text.includes('"errors"')) {
      const parsed = JSON.parse(text)
      const errorMsg = parsed.errors?.[0]?.message || 'Unknown GraphQL error'
      const debugInfo = parsed.errors?.[0]?.debug_info || ''
      return { success: false, message: `${errorMsg} ${debugInfo}`.trim() }
    }
    return { success: true, message: 'Post deleted successfully' }
  } catch (err) {
    console.error('API Delete Error:', err)
    return { success: false, message: String(err) }
  }
}


// ─── Pending Posts Tool ───
interface PendingPost {
  id: string
  message: string
  created_time: string
  author_name: string
  author_id: string
}

async function getPendingPosts(
  groupId: string,
  count: number = 20,
  cursor: string | null = null
): Promise<{ success: boolean; posts?: PendingPost[]; cursor?: string | null; hasNextPage?: boolean; message?: string }> {
  const fb_dtsg = getFBDTSG()
  const av = getUserID()

  if (!fb_dtsg || !av) {
    return { success: false, message: 'Tokens missing (fb_dtsg or av)' }
  }

  try {
    const res = await fetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'av': av,
        '__user': av,
        '__a': '1',
        'fb_dtsg': fb_dtsg,
        'fb_api_caller_class': 'RelayModern',
        'fb_api_req_friendly_name': 'GroupsCometPendingPostsFeedPaginationQuery',
        'server_timestamps': 'true',
        'variables': JSON.stringify({
          count,
          cursor: cursor ?? null,
          feedLocation: 'GROUP_PENDING',
          feedbackSource: 0,
          focusCommentID: null,
          hoistedPostID: null,
          pendingStoriesOrderBy: null,
          privacySelectorRenderLocation: 'COMET_STREAM',
          referringStoryRenderLocation: null,
          renderLocation: 'group_pending_queue',
          scale: 1,
          useDefaultActor: false,
          id: groupId,
          '__relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider': true,
          '__relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider': true,
          '__relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider': false,
          '__relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider': false,
          '__relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider': false,
          '__relay_internal__pv__IsWorkUserrelayprovider': false,
          '__relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider': false,
          '__relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider': true,
          '__relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider': true,
          '__relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider': false,
          '__relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider': false,
          '__relay_internal__pv__IsMergQAPollsrelayprovider': false,
          '__relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider': true,
          '__relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider': false,
          '__relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider': 'ORIGINAL',
          '__relay_internal__pv__CometUFIShareActionMigrationrelayprovider': true,
          '__relay_internal__pv__CometUFISingleLineUFIrelayprovider': true,
          '__relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider': true,
          '__relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider': true,
          '__relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider': 206,
          '__relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider': false,
          '__relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider': true,
        }),
        'doc_id': '26459183580414880',
      }),
    })

    const text = await res.text()

    // Facebook trả về nhiều dòng JSON (ndjson), chỉ lấy dòng đầu
    const firstLine = text.split('\n')[0]
    const data = JSON.parse(firstLine)

    // Log raw để debug nếu cần
    console.log('[getPendingPosts] raw response:', text.slice(0, 800))

    if (data?.errors) {
      const errMsg = data.errors[0]?.message || 'GraphQL error'
      console.error('[getPendingPosts] errors:', data.errors)
      return { success: false, message: errMsg }
    }

    const section =
      data?.data?.node?.pending_posts_section_stories   // path phổ biến
      ?? data?.data?.node?.timeline_feed_units          // fallback 1
      ?? data?.data?.viewer?.news_feed                  // fallback 2
    const edges: any[] = section?.edges || []
    const pageInfo = section?.page_info || {}

    console.log('[getPendingPosts] data path node:', JSON.stringify(data?.data?.node)?.slice(0, 300))

    const posts: PendingPost[] = edges.map((e: any) => {
      const node = e.node || {}
      const actor = node.actors?.[0] || {}
      return {
        id: node.id || '',
        message: node.message?.text || '',
        created_time: node.creation_time
          ? new Date(node.creation_time * 1000).toISOString()
          : '',
        author_name: actor.name || '',
        author_id: actor.id || '',
      }
    })

    return {
      success: true,
      posts,
      cursor: pageInfo.end_cursor ?? null,
      hasNextPage: pageInfo.has_next_page ?? false,
    }
  } catch (err) {
    console.error('getPendingPosts error:', err)
    return { success: false, message: String(err) }
  }
}

// ─── Post Cleaner Tool ───
interface CleanerConfig {
  keywords: string
  maxPosts: number
  fromDate: string
}

let cleanerAborted = false

function sendLog(text: string, logType: string = 'info') {
  chrome.runtime.sendMessage({ type: 'CLEANER_LOG', text, logType })
}

function sendDone(text: string) {
  chrome.runtime.sendMessage({ type: 'CLEANER_DONE', text })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}


function matchesKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true // No filter = match all
  return keywords.some((kw) => text.includes(kw.toLowerCase().trim()))
}


async function runPostCleaner(config: CleanerConfig, token: string, groupId: string): Promise<void> {
  cleanerAborted = false

  const keywords = config.keywords
    ? config.keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
    : []
  const fromDate = config.fromDate ? new Date(config.fromDate) : null

  sendLog(`Filters: ${keywords.length > 0 ? `keywords=[${keywords.join(', ')}]` : 'no keyword filter'}, max=${config.maxPosts}${fromDate ? `, from=${config.fromDate}` : ''}`)
  sendLog(`Group ID: ${groupId}`)

  let deletedCount = 0
  let scannedCount = 0
  let fetchAttempts = 0
  // const maxFetchAttempts = 50
  const processedPosts = new Set<string>()

  let nextUrl: string | null = `https://graph.facebook.com/v22.0/${groupId}/feed?access_token=${token}&limit=50`

  while (deletedCount < config.maxPosts && nextUrl) {
    if (cleanerAborted) {
      sendDone(`Aborted. Deleted ${deletedCount} post(s).`)
      return
    }

    fetchAttempts++
    sendLog(`Fetching feed from API (page ${fetchAttempts})...`)

    let articles: any[] = []
    try {
      const response = await fetch(nextUrl, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'accept': '*/*',
          'content-type': 'application/x-www-form-urlencoded',
          'origin': 'https://developers.facebook.com',
          'referer': 'https://developers.facebook.com/',
        },
      })
      const data = await response.json()

      articles = data.data || []

      if (articles.length === 0) {
        sendLog('No more articles found from API response.', 'warning')
        break
      }

      // Check if there are any new (unprocessed) posts in this batch
      const newPosts = articles.filter((p: any) => !processedPosts.has(p.id))
      if (newPosts.length === 0) {
        sendLog('All returned posts have already been processed. No new posts to scan.', 'warning')
        break
      }
    } catch (err) {
      sendLog(`API fetch failed: ${err}`, 'error')
      sendDone('Failed: Graph API error.')
      return
    }

    for (const post of articles) {
      if (cleanerAborted) break
      if (deletedCount >= config.maxPosts) break

      const postIdRaw = post.id
      if (processedPosts.has(postIdRaw)) continue

      processedPosts.add(postIdRaw)
      scannedCount++

      const postText = (post.message || post.story || '').toLowerCase()

      // Keyword filter
      if (!matchesKeywords(postText, keywords)) continue

      // Date filter (basic: skip if we can't determine date)
      if (fromDate) {
        const postDate = new Date(post.updated_time)
        if (postDate < fromDate) {
          sendLog(`Post ${scannedCount}: older than fromDate, skipping.`)
          continue
        }
        sendLog(`Post ${scannedCount}: matched keywords, attempting deletion...`)
      } else {
        const preview = postText.slice(0, 60).replace(/\n/g, ' ')
        sendLog(`Post ${scannedCount}: matched "${preview}..."`)
      }

      // Step 1: Get story ID
      const postIdParts = postIdRaw.split('_')
      const postId = postIdParts.length > 1 ? postIdParts[1] : postIdRaw
      const actorId = getUserID()

      const storyId = actorId && postId ? btoa(`S:_I${actorId}:VK:${postId}`) : null

      if (!storyId) {
        sendLog(`Could not determine story ID for post ${scannedCount}, skipping.`, 'warning')
        continue
      }

      // Step 2: Delete via API
      sendLog(`Deleting post ${scannedCount} via API...`)
      const deleteResult = await apiDeletePost(storyId)

      if (!deleteResult.success) {
        sendLog(`Failed to delete post ${scannedCount}: ${deleteResult.message}`, 'error')
        continue
      }

      deletedCount++
      sendLog(`✓ Post ${scannedCount} deleted! (${deletedCount}/${config.maxPosts})`, 'success')

      // Wait a bit to avoid rate-limiting
      await delay(800 + Math.random() * 500)
    }
  }

  sendDone(`Done! Deleted ${deletedCount} post(s), scanned ${scannedCount} post(s).`)
}

// ─── Pending Cleaner ───
async function runPendingCleaner(config: CleanerConfig, groupId: string): Promise<void> {
  cleanerAborted = false

  const keywords = config.keywords
    ? config.keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
    : []

  sendLog(`[Pending] Filters: ${keywords.length > 0 ? `keywords=[${keywords.join(', ')}]` : 'no filter'}, max=${config.maxPosts}`)
  sendLog(`[Pending] Group ID: ${groupId}`)

  let deletedCount = 0
  let scannedCount = 0
  let cursor: string | null = null

  while (deletedCount < config.maxPosts) {
    if (cleanerAborted) {
      sendDone(`Aborted. Deleted ${deletedCount} pending post(s).`)
      return
    }

    sendLog(`Fetching pending posts…`)
    const result = await getPendingPosts(groupId, 20, cursor)
    if (!result.success) {
      sendLog(`Failed to fetch: ${result.message}`, 'error')
      sendDone('Failed.')
      return
    }

    const posts = result.posts ?? []
    if (posts.length === 0) {
      sendLog('No more pending posts found.', 'warning')
      break
    }

    for (const post of posts) {
      if (cleanerAborted) break
      if (deletedCount >= config.maxPosts) break

      scannedCount++
      const postText = post.message.toLowerCase()

      if (!matchesKeywords(postText, keywords)) {
        sendLog(`Post ${scannedCount}: no keyword match, skipping.`)
        continue
      }

      const preview = postText.slice(0, 60).replace(/\n/g, ' ')
      sendLog(`Post ${scannedCount}: “${preview}…” — deleting...`)

      // story_id từ pending GraphQL đã ở dạng chuẩn
      const deleteResult = await apiDeletePost(post.id)
      if (!deleteResult.success) {
        sendLog(`Failed to delete post ${scannedCount}: ${deleteResult.message}`, 'error')
        continue
      }

      deletedCount++
      sendLog(`✓ Pending post ${scannedCount} deleted! (${deletedCount}/${config.maxPosts})`, 'success')
      await delay(800 + Math.random() * 500)
    }

    if (!result.hasNextPage || !result.cursor) break
    cursor = result.cursor
  }

  sendDone(`Done! Deleted ${deletedCount} pending post(s), scanned ${scannedCount} total.`)
}

// ─── Spam Posts (Modmin Review Folder) ───
interface SpamPost {
  id: string          // story ID (base64 encoded)
  post_id: string     // numeric post ID
  contentType: string // e.g. GROUP_POST
  message: string
  created_time: string
  author_name: string
  author_id: string
}

async function getSpamPosts(
  groupId: string,
  count: number = 10,
  cursor: string | null = null
): Promise<{ success: boolean; posts?: SpamPost[]; cursor?: string | null; hasNextPage?: boolean; message?: string }> {
  const fb_dtsg = getFBDTSG()
  const av = getUserID()

  if (!fb_dtsg || !av) {
    return { success: false, message: 'Tokens missing (fb_dtsg or av)' }
  }

  try {
    const variables: Record<string, any> = {
      contentType: null,
      count,
      cursor: cursor ?? null,
      feedLocation: 'GROUPS_MODMIN_REVIEW_FOLDER',
      feedbackSource: 0,
      focusCommentID: null,
      privacySelectorRenderLocation: 'COMET_STREAM',
      referringStoryRenderLocation: null,
      renderLocation: 'groups_modmin_review_folder',
      scale: 1,
      searchTerm: null,
      useDefaultActor: false,
      id: groupId,
      '__relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider': true,
      '__relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider': true,
      '__relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider': false,
      '__relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider': false,
      '__relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider': false,
      '__relay_internal__pv__IsWorkUserrelayprovider': false,
      '__relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider': false,
      '__relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider': true,
      '__relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider': true,
      '__relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider': false,
      '__relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider': false,
      '__relay_internal__pv__IsMergQAPollsrelayprovider': false,
      '__relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider': true,
      '__relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider': false,
      '__relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider': 'ORIGINAL',
      '__relay_internal__pv__CometUFIShareActionMigrationrelayprovider': true,
      '__relay_internal__pv__CometUFISingleLineUFIrelayprovider': true,
      '__relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider': true,
      '__relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider': true,
      '__relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider': 206,
      '__relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider': false,
      '__relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider': true,
    }

    const res = await fetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-fb-friendly-name': 'GroupsCometModminReviewFolderContentContainerQuery',
      },
      body: new URLSearchParams({
        'av': av,
        '__user': av,
        '__a': '1',
        'fb_dtsg': fb_dtsg,
        'fb_api_caller_class': 'RelayModern',
        'fb_api_req_friendly_name': 'GroupsCometModminReviewFolderContentContainerQuery',
        'server_timestamps': 'true',
        'variables': JSON.stringify(variables),
        'doc_id': '34904810272499153',
      }),
    })

    const text = await res.text()

    // Facebook may return multiple JSON lines (ndjson)
    const firstLine = text.split('\n')[0]
    const data = JSON.parse(firstLine)

    console.log('[getSpamPosts] raw response:', text.slice(0, 800))

    if (data?.errors) {
      const errMsg = data.errors[0]?.message || 'GraphQL error'
      console.error('[getSpamPosts] errors:', data.errors)
      return { success: false, message: errMsg }
    }

    const folder = data?.data?.node?.modmin_review_folder
    const edges: any[] = folder?.edges || []
    const pageInfo = folder?.page_info || {}

    const posts: SpamPost[] = edges.map((e: any) => {
      const node = e.node || {}
      // Get message from the story content - try multiple paths
      const storyContent = node.comet_sections?.content?.story
      const messageText =
        storyContent?.message?.text
        ?? storyContent?.comet_sections?.message?.story?.message?.text
        ?? node.message?.text
        ?? ''

      // Get author info from feedback.owning_profile or actors
      const owningProfile = node.feedback?.owning_profile || {}
      const actor = storyContent?.actors?.[0] || {}

      return {
        id: node.id || '',
        post_id: node.post_id || storyContent?.post_id || '',
        contentType: node.group_reportable_type || 'GROUP_POST',
        message: messageText,
        created_time: storyContent?.creation_time
          ? new Date(storyContent.creation_time * 1000).toISOString()
          : (node.creation_time ? new Date(node.creation_time * 1000).toISOString() : ''),
        author_name: owningProfile.name || actor.name || '',
        author_id: owningProfile.id || actor.id || '',
      }
    })

    return {
      success: true,
      posts,
      cursor: pageInfo.end_cursor ?? edges[edges.length - 1]?.cursor ?? null,
      hasNextPage: pageInfo.has_next_page ?? (edges.length >= count),
    }
  } catch (err) {
    console.error('getSpamPosts error:', err)
    return { success: false, message: String(err) }
  }
}

// ─── Decline Spam Post (Modmin Review Folder) ───
async function apiDeclineSpamPost(
  groupId: string,
  storyId: string,
  memberId: string,
  contentType: string = 'GROUP_POST'
): Promise<{ success: boolean; message: string }> {
  const fb_dtsg = getFBDTSG()
  const av = getUserID()

  if (!fb_dtsg || !av) {
    return { success: false, message: 'Tokens missing (fb_dtsg or av)' }
  }

  console.log('Declining spam post:', { groupId, storyId, memberId, contentType })

  try {
    const res = await fetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-fb-friendly-name': 'GroupsCometModminReviewFolderDeclineContentMutation',
      },
      body: new URLSearchParams({
        'av': av,
        '__user': av,
        '__a': '1',
        'fb_dtsg': fb_dtsg,
        'fb_api_caller_class': 'RelayModern',
        'fb_api_req_friendly_name': 'GroupsCometModminReviewFolderDeclineContentMutation',
        'server_timestamps': 'true',
        'variables': JSON.stringify({
          input: {
            action_source: 'GROUP_MODMIN_REVIEW_FOLDER',
            group_id: groupId,
            story_id: storyId,
            actor_id: av,
            client_mutation_id: Math.floor(Math.random() * 1000).toString(),
          },
          contentType,
          member_id: memberId,
        }),
        'doc_id': '30216535437945305',
      }),
    })

    const text = await res.text()
    console.log('Decline spam response:', text.slice(0, 500))

    if (text.includes('"errors"')) {
      const parsed = JSON.parse(text)
      const errorMsg = parsed.errors?.[0]?.message || 'Unknown GraphQL error'
      return { success: false, message: errorMsg }
    }
    return { success: true, message: 'Spam post declined successfully' }
  } catch (err) {
    console.error('Decline spam error:', err)
    return { success: false, message: String(err) }
  }
}

// ─── Spam Cleaner ───
async function runSpamCleaner(config: CleanerConfig, groupId: string): Promise<void> {
  cleanerAborted = false

  const keywords = config.keywords
    ? config.keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
    : []

  sendLog(`[Spam] Filters: ${keywords.length > 0 ? `keywords=[${keywords.join(', ')}]` : 'no filter (delete all)'}, max=${config.maxPosts}`)
  sendLog(`[Spam] Group ID: ${groupId}`)

  let deletedCount = 0
  let scannedCount = 0
  let cursor: string | null = null

  while (deletedCount < config.maxPosts) {
    if (cleanerAborted) {
      sendDone(`Aborted. Declined ${deletedCount} spam post(s).`)
      return
    }

    sendLog(`Fetching spam posts…`)
    const result = await getSpamPosts(groupId, 10, cursor)
    if (!result.success) {
      sendLog(`Failed to fetch spam posts: ${result.message}`, 'error')
      sendDone('Failed.')
      return
    }

    const posts = result.posts ?? []
    if (posts.length === 0) {
      sendLog('No more spam posts found.', 'warning')
      break
    }

    sendLog(`Fetched ${posts.length} spam post(s).`)

    for (const post of posts) {
      if (cleanerAborted) break
      if (deletedCount >= config.maxPosts) break

      scannedCount++
      const postText = (post.message || '').toLowerCase()

      if (!matchesKeywords(postText, keywords)) {
        const preview = postText.slice(0, 40).replace(/\n/g, ' ') || '(no text)'
        sendLog(`Post ${scannedCount}: no keyword match, skipping. "${preview}…"`)
        continue
      }

      const preview = postText.slice(0, 60).replace(/\n/g, ' ') || '(no text)'
      sendLog(`Post ${scannedCount}: "${preview}…" by ${post.author_name || 'unknown'} — declining...`)

      const declineResult = await apiDeclineSpamPost(groupId, post.id, post.author_id, post.contentType)
      if (!declineResult.success) {
        sendLog(`Failed to decline spam post ${scannedCount}: ${declineResult.message}`, 'error')
        continue
      }

      deletedCount++
      sendLog(`✓ Spam post ${scannedCount} declined! (${deletedCount}/${config.maxPosts})`, 'success')
      await delay(800 + Math.random() * 500)
    }

    if (!result.hasNextPage || !result.cursor) break
    cursor = result.cursor
  }

  sendDone(`Done! Declined ${deletedCount} spam post(s), scanned ${scannedCount} total.`)
}

// ─── Message Listener ───
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true })
    return
  }

  if (message.type === 'SET_FONT_SIZE') {
    applyFontSize(message.size)
    sendResponse({ ok: true })
  }

  if (message.type === 'GET_GROUP_ID') {
    const html = document.documentElement.innerHTML
    // Search for groupID patterns in the page source
    const patterns = [
      /"groupID"\s*:\s*"(\d+)"/,
      /"group_id"\s*:\s*"(\d+)"/,
      /\/groups\/(\d+)/,
      /"groupId"\s*:\s*"(\d+)"/,
    ]
    let foundGroupId: string | null = null
    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match?.[1]) {
        foundGroupId = match[1]
        break
      }
    }
    sendResponse({ groupId: foundGroupId })
    return
  }

  if (message.type === 'START_POST_CLEANER') {
    sendResponse({ ok: true })
    runPostCleaner(message.config as CleanerConfig, message.token as string, message.groupId as string)
  }

  if (message.type === 'START_PENDING_CLEANER') {
    sendResponse({ ok: true })
    runPendingCleaner(message.config as CleanerConfig, message.groupId as string)
  }

  if (message.type === 'START_SPAM_CLEANER') {
    sendResponse({ ok: true })
    runSpamCleaner(message.config as CleanerConfig, message.groupId as string)
  }

  if (message.type === 'TEST_DELETE_POST') {
    const actorId = getUserID()
    if (!actorId) {
      sendResponse({ success: false, message: 'Could not find User ID' })
      return
    }

    let postId = message.postId
    // Extract short ID if formatted as "groupid_postid"
    if (postId.includes('_')) {
      postId = postId.split('_')[1]
    }

    // Use refined Comet story ID format: S:_I<uid>:VK:<pid>
    const storyId = btoa(`S:_I${actorId}:VK:${postId}`)
    apiDeletePost(storyId).then(sendResponse)
    return true
  }

  if (message.type === 'LIKE_POST') {
    likePost(message.feedbackId).then(sendResponse)
    return true // Keep channel open for async response
  }

  if (message.type === 'GET_PENDING_POSTS') {
    getPendingPosts(
      message.groupId as string,
      (message.count as number) || 20,
      (message.cursor as string | null) || null
    ).then(sendResponse)
    return true // Keep channel open for async response
  }

  if (message.type === 'GET_SPAM_POSTS') {
    getSpamPosts(
      message.groupId as string,
      (message.count as number) || 10,
      (message.cursor as string | null) || null
    ).then(sendResponse)
    return true // Keep channel open for async response
  }
})
