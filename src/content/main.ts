// ─── Font Size Tool ───
const STORAGE_KEY = "fb-feed-font-size";
const STYLE_ID = "crxjs-fb-font-size";

function applyFontSize(size: number) {
  let style = document.getElementById(
    STYLE_ID,
  ) as HTMLStyleElement | null;

  if (size === 100) {
    style?.remove();
    return;
  }

  if (!style) {
    style =
      document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }

  const zoom = size / 100;
  style.textContent = `
    div[role="feed"] {
      zoom: ${zoom} !important;
    }
  `;
}

chrome.storage.local
  .get(STORAGE_KEY)
  .then((result) => {
    const size = result[STORAGE_KEY] as
      | number
      | undefined;
    if (size && size !== 100) {
      applyFontSize(size);
    }
  });

chrome.storage.onChanged.addListener(
  (changes) => {
    if (changes[STORAGE_KEY]) {
      const size =
        (changes[STORAGE_KEY]
          .newValue as number) ?? 100;
      applyFontSize(size);
    }
  },
);

// ─── Facebook GraphQL Helpers ───
function getFBDTSG(): string | null {
  // 1. Try meta tags or specific global variables if they were exposed (not possible in isolated world, so search HTML)
  // 2. Search for common patterns in page source
  const html =
    document.documentElement.innerHTML;

  // Pattern 1: ["token","..."] or "token":"..."
  const patterns = [
    /["']fb_dtsg["']\s*[:]\s*["']([^"']+)["']/,
    /["']DTSGInitialData["']\s*,\s*\[\]\s*,\s*\{\s*["']token["']\s*:\s*["']([^"']+)["']/,
    /["']token["']\s*:\s*["']([^"']+)["']\s*,\s*["']async_get_token["']/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  // 3. Last resort: check any hidden input named fb_dtsg
  const input = document.querySelector(
    'input[name="fb_dtsg"]',
  ) as HTMLInputElement;
  return input?.value || null;
}

function getUserID(): string | null {
  // 1. Try cookie
  const cookieMatch =
    document.cookie.match(
      /c_user=(\d+)/,
    );
  if (cookieMatch?.[1])
    return cookieMatch[1];

  // 2. Try page source patterns if cookie is inaccessible
  const html =
    document.documentElement.innerHTML;
  const patterns = [
    /["']USER_ID["']\s*:\s*["'](\d+)["']/,
    /["']actorID["']\s*:\s*["'](\d+)["']/,
    /["']ACCOUNT_ID["']\s*:\s*["'](\d+)["']/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    console.log("MATCH:  " + match);

    if (match?.[1]) return match[1];
  }

  return null;
}

async function likePost(
  feedbackId: string,
): Promise<{
  success: boolean;
  message: string;
}> {
  console.log(
    "Attempting to like post:",
    feedbackId,
  );
  const fb_dtsg = getFBDTSG();
  const av = getUserID();

  if (!fb_dtsg) {
    const error =
      "Không tìm thấy token bảo mật (fb_dtsg). Nếu bạn đang ở một trang bị hạn chế, hãy thử tải lại trang.";
    sendLog(error, "error");
    return {
      success: false,
      message: error,
    };
  }

  if (!av) {
    const error =
      "Không tìm thấy ID người dùng. Hãy chắc chắn bạn đã đăng nhập Facebook.";
    sendLog(error, "error");
    return {
      success: false,
      message: error,
    };
  }

  try {
    const res = await fetch(
      "https://www.facebook.com/api/graphql/",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type":
            "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          av: av,
          __user: av,
          __a: "1",
          fb_dtsg: fb_dtsg,
          fb_api_caller_class:
            "RelayModern",
          fb_api_req_friendly_name:
            "CometUFIFeedbackReactMutation",
          variables: JSON.stringify({
            input: {
              attribution_id_v2:
                "CometGroupDiscussionRoot.react,comet.group,via_cold_start," +
                Date.now(),
              feedback_id: feedbackId,
              feedback_reaction_id:
                "1635855486666999", // Like reaction
              feedback_source:
                "PROFILE",
              is_tracking_encrypted: true,
              session_id:
                crypto.randomUUID(),
              actor_id: av,
              client_mutation_id: "1",
            },
            useDefaultActor: false,
            __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
          }),
          doc_id: "33371893662453814",
        }),
      },
    );

    const text = await res.text();
    if (text.includes('"errors"')) {
      const errorMsg =
        JSON.parse(text).errors[0]
          .message;
      sendLog(
        `Không thể thích bài viết: ${errorMsg}`,
        "error",
      );
      return {
        success: false,
        message: errorMsg,
      };
    } else {
      const successMsg =
        "Đã thích bài viết thành công!";
      sendLog(successMsg, "success");
      return {
        success: true,
        message: successMsg,
      };
    }
  } catch (err) {
    const errorMsg = `Lỗi khi thích bài viết: ${err}`;
    sendLog(errorMsg, "error");
    return {
      success: false,
      message: errorMsg,
    };
  }
}

async function decrementUsageLimit(): Promise<{ success: boolean; newLimit?: number; message?: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "DECREMENT_USAGE" }, (res) => {
      if (!res) {
        resolve({ success: false, message: "Không thể kết nối với dịch vụ nền" });
        return;
      }
      if (res.success && res.data) {
        // Appwrite should return the updated usage limit
        resolve({ success: true, newLimit: res.data.usageLimit });
      } else {
        resolve({ success: false, message: res.error || "Lỗi cập nhật giới hạn" });
      }
    });
  });
}

async function apiDeletePost(
  storyId: string,
): Promise<{
  success: boolean;
  message: string;
}> {
  const fb_dtsg = getFBDTSG();
  const av = getUserID();

  if (!fb_dtsg || !av) {
    return {
      success: false,
      message:
        "Thiếu token (fb_dtsg hoặc av)",
    };
  }

  console.log(
    "API Deleting storyId:",
    storyId,
    "with actor:",
    av,
  );

  try {
    const signal = getCleanerSignal();
    const res = await fetch(
      "https://www.facebook.com/api/graphql/",
      {
        method: "POST",
        credentials: "include",
        signal,
        headers: {
          "content-type":
            "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          av: av,
          __user: av,
          __a: "1",
          fb_dtsg: fb_dtsg,
          fb_api_caller_class:
            "RelayModern",
          fb_api_req_friendly_name:
            "useCometFeedStoryDeleteMutation",
          variables: JSON.stringify({
            input: {
              story_id: storyId,
              story_location: "GROUP", // Switched from PERMALINK
              actor_id: av,
              client_mutation_id:
                Math.floor(
                  Math.random() * 1000,
                ).toString(),
            },
            groupID: null,
            inviteShortLinkKey: null,
            renderLocation: null,
            scale: 1,
            __relay_internal__pv__groups_comet_use_glvrelayprovider: false,
          }),
          doc_id: "33779779394969988",
        }),
      },
    );

    const text = await res.text();
    console.log(
      "GraphQL Response:",
      text,
    );

    if (text.includes('"errors"')) {
      const parsed = JSON.parse(text);
      const errorMsg =
        parsed.errors?.[0]?.message ||
        "Lỗi GraphQL không xác định";
      const debugInfo =
        parsed.errors?.[0]
          ?.debug_info || "";
      return {
        success: false,
        message:
          `${errorMsg} ${debugInfo}`.trim(),
      };
    }
    
    // Giảm giới hạn token sau khi xóa thành công
    const usageRes = await decrementUsageLimit();
    if (!usageRes.success) {
      sendLog("Lỗi cập nhật License: " + usageRes.message, "warning");
    } else if (usageRes.newLimit !== undefined && usageRes.newLimit <= 0) {
      sendLog("License Token của bạn đã hết lượt sử dụng (usageLimit = 0). Tiến trình sẽ tự động dừng lại.", "error");
      if (cleanerAbortController) {
        cleanerAbortController.abort();
      }
    }

    return {
      success: true,
      message:
        "Xóa bài viết thành công",
    };
  } catch (err) {
    if (
      err instanceof DOMException &&
      err.name === "AbortError"
    ) throw err;
    console.error(
      "API Delete Error:",
      err,
    );
    return {
      success: false,
      message: String(err),
    };
  }
}

// ─── Pending Posts Tool ───
interface PendingPost {
  id: string;
  message: string;
  created_time: string;
  author_name: string;
  author_id: string;
}

async function getPendingPosts(
  groupId: string,
  count: number = 20,
  cursor: string | null = null,
): Promise<{
  success: boolean;
  posts?: PendingPost[];
  cursor?: string | null;
  hasNextPage?: boolean;
  message?: string;
}> {
  const fb_dtsg = getFBDTSG();
  const av = getUserID();

  if (!fb_dtsg || !av) {
    return {
      success: false,
      message:
        "Thiếu token (fb_dtsg hoặc av)",
    };
  }

  try {
    const signal = getCleanerSignal();
    const res = await fetch(
      "https://www.facebook.com/api/graphql/",
      {
        method: "POST",
        credentials: "include",
        signal,
        headers: {
          "content-type":
            "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          av: av,
          __user: av,
          __a: "1",
          fb_dtsg: fb_dtsg,
          fb_api_caller_class:
            "RelayModern",
          fb_api_req_friendly_name:
            "GroupsCometPendingPostsFeedPaginationQuery",
          server_timestamps: "true",
          variables: JSON.stringify({
            count,
            cursor: cursor ?? null,
            feedLocation:
              "GROUP_PENDING",
            feedbackSource: 0,
            focusCommentID: null,
            hoistedPostID: null,
            pendingStoriesOrderBy: null,
            privacySelectorRenderLocation:
              "COMET_STREAM",
            referringStoryRenderLocation:
              null,
            renderLocation:
              "group_pending_queue",
            scale: 1,
            useDefaultActor: false,
            id: groupId,
            __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
            __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
            __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
            __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: false,
            __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
            __relay_internal__pv__IsWorkUserrelayprovider: false,
            __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
            __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
            __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
            __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
            __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
            __relay_internal__pv__IsMergQAPollsrelayprovider: false,
            __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
            __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
            __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider:
              "ORIGINAL",
            __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
            __relay_internal__pv__CometUFISingleLineUFIrelayprovider: true,
            __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
            __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
            __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
            __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
            __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: true,
          }),
          doc_id: "26459183580414880",
        }),
      },
    );

    const text = await res.text();

    // Facebook trả về nhiều dòng JSON (ndjson), chỉ lấy dòng đầu
    const firstLine =
      text.split("\n")[0];
    const data = JSON.parse(firstLine);

    // Log raw để debug nếu cần
    console.log(
      "[getPendingPosts] raw response:",
      text.slice(0, 800),
    );

    if (data?.errors) {
      const errMsg =
        data.errors[0]?.message ||
        "Lỗi GraphQL";
      console.error(
        "[getPendingPosts] errors:",
        data.errors,
      );
      return {
        success: false,
        message: errMsg,
      };
    }

    const section =
      data?.data?.node
        ?.pending_posts_section_stories ?? // path phổ biến
      data?.data?.node
        ?.timeline_feed_units ?? // fallback 1
      data?.data?.viewer?.news_feed; // fallback 2
    const edges: any[] =
      section?.edges || [];
    const pageInfo =
      section?.page_info || {};

    console.log(
      "[getPendingPosts] data path node:",
      JSON.stringify(
        data?.data?.node,
      )?.slice(0, 300),
    );

    const posts: PendingPost[] =
      edges.map((e: any) => {
        const node = e.node || {};
        const actor =
          node.actors?.[0] || {};
        return {
          id: node.id || "",
          message:
            node.message?.text || "",
          created_time:
            node.creation_time
              ? new Date(
                  node.creation_time *
                    1000,
                ).toISOString()
              : "",
          author_name: actor.name || "",
          author_id: actor.id || "",
        };
      });

    return {
      success: true,
      posts,
      cursor:
        pageInfo.end_cursor ?? null,
      hasNextPage:
        pageInfo.has_next_page ?? false,
    };
  } catch (err) {
    if (
      err instanceof DOMException &&
      err.name === "AbortError"
    ) throw err;
    console.error(
      "getPendingPosts error:",
      err,
    );
    return {
      success: false,
      message: String(err),
    };
  }
}

// ─── Post Cleaner Tool ───
interface CleanerConfig {
  keywords: string;
  maxPosts: number;
  fromDate: string;
}

let cleanerAbortController: AbortController | null =
  null;

function getCleanerSignal(): AbortSignal {
  return (
    cleanerAbortController?.signal ??
    new AbortController().signal
  );
}

function sendLog(
  text: string,
  logType: string = "info",
) {
  chrome.runtime.sendMessage({
    type: "CLEANER_LOG",
    text,
    logType,
  });
}

function sendDone(text: string) {
  chrome.runtime.sendMessage({
    type: "CLEANER_DONE",
    text,
  });
}

function delay(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise(
    (resolve, reject) => {
      if (signal?.aborted) {
        reject(
          new DOMException(
            "Aborted",
            "AbortError",
          ),
        );
        return;
      }
      const timer = setTimeout(
        resolve,
        ms,
      );
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(
            new DOMException(
              "Aborted",
              "AbortError",
            ),
          );
        },
        { once: true },
      );
    },
  );
}

function checkAbort(
  signal?: AbortSignal,
) {
  if (signal?.aborted) {
    throw new DOMException(
      "Aborted",
      "AbortError",
    );
  }
}

function matchesKeywords(
  text: string,
  keywords: string[],
): boolean {
  if (keywords.length === 0)
    return true; // No filter = match all
  return keywords.some((kw) =>
    text.includes(
      kw.toLowerCase().trim(),
    ),
  );
}

// ─── NDJSON / Streaming Relay parser ───
// Facebook's GraphQL responses concatenate multiple JSON objects
// with spaces or newlines. This function splits them by tracking
// brace depth at the top level.
function splitTopLevelJsonObjects(
  text: string,
): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;

  for (
    let i = 0;
    i < text.length;
    i++
  ) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        results.push(
          text.substring(start, i + 1),
        );
        start = -1;
      }
    } else if (ch === '"') {
      // Skip string contents to avoid
      // counting braces inside strings
      i++;
      while (
        i < text.length &&
        text[i] !== '"'
      ) {
        if (text[i] === "\\") i++; // skip escaped char
        i++;
      }
    }
  }

  return results;
}

// ─── Feed Posts via GraphQL (cookie-based, no access token needed) ───
interface FeedPost {
  id: string; // story ID (base64 encoded)
  post_id: string; // numeric post ID
  message: string;
  created_time: string;
  author_name: string;
  author_id: string;
}

async function getFeedPostsGraphQL(
  groupId: string,
  count: number = 3,
  cursor: string | null = null,
): Promise<{
  success: boolean;
  posts?: FeedPost[];
  cursor?: string | null;
  hasNextPage?: boolean;
  message?: string;
}> {
  const fb_dtsg = getFBDTSG();
  const av = getUserID();

  if (!fb_dtsg || !av) {
    return {
      success: false,
      message:
        "Thiếu token (fb_dtsg hoặc av)",
    };
  }

  try {
    const variables: Record<
      string,
      any
    > = {
      count,
      cursor: cursor ?? null,
      feedLocation: "GROUP",
      feedType: "DISCUSSION",
      feedbackSource: 0,
      filterTopicId: null,
      focusCommentID: null,
      privacySelectorRenderLocation:
        "COMET_STREAM",
      referringStoryRenderLocation:
        null,
      renderLocation: "group",
      scale: 1,
      sortingSetting: "CHRONOLOGICAL",
      stream_initial_count: 1,
      useDefaultActor: false,
      id: groupId,
      __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
      __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
      __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
      __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: false,
      __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
      __relay_internal__pv__IsWorkUserrelayprovider: false,
      __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
      __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
      __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
      __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
      __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
      __relay_internal__pv__IsMergQAPollsrelayprovider: false,
      __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
      __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
      __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider:
        "ORIGINAL",
      __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
      __relay_internal__pv__CometUFISingleLineUFIrelayprovider: true,
      __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
      __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
      __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
      __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
      __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: true,
    };

    const signal = getCleanerSignal();
    const res = await fetch(
      "https://www.facebook.com/api/graphql/",
      {
        method: "POST",
        credentials: "include",
        signal,
        headers: {
          "content-type":
            "application/x-www-form-urlencoded",
          "x-fb-friendly-name":
            "GroupsCometFeedRegularStoriesPaginationQuery",
        },
        body: new URLSearchParams({
          av: av,
          __user: av,
          __a: "1",
          fb_dtsg: fb_dtsg,
          fb_api_caller_class:
            "RelayModern",
          fb_api_req_friendly_name:
            "GroupsCometFeedRegularStoriesPaginationQuery",
          server_timestamps: "true",
          variables:
            JSON.stringify(variables),
          doc_id: "26421509580849888",
        }),
      },
    );

    const text = await res.text();

    // Facebook returns streaming relay responses where multiple JSON objects
    // are concatenated with spaces or newlines (NDJSON).
    // We must split them by finding top-level {} boundaries.
    const jsonChunks =
      splitTopLevelJsonObjects(text);
    const allNodes: any[] = [];
    let lastCursor: string | null =
      null;

    console.log(
      "[getFeedPostsGraphQL] found",
      jsonChunks.length,
      "JSON chunks",
    );

    for (const chunk of jsonChunks) {
      try {
        const json = JSON.parse(chunk);

        // Check for errors in any chunk
        if (
          json?.errors &&
          !json?.data
        ) {
          const errMsg =
            json.errors[0]?.message ||
            "Lỗi GraphQL";
          console.error(
            "[getFeedPostsGraphQL] errors:",
            json.errors,
          );
          return {
            success: false,
            message: errMsg,
          };
        }

        // Base response: data.node.group_feed.edges[]
        const baseEdges =
          json?.data?.node?.group_feed
            ?.edges;
        if (
          baseEdges &&
          Array.isArray(baseEdges)
        ) {
          for (const edge of baseEdges) {
            if (edge.node) {
              allNodes.push({
                node: edge.node,
                cursor: edge.cursor,
              });
            }
          }
        }

        // Streamed chunks: { path: ["node","group_feed","edges", N], data: { node: {...}, cursor: "..." } }
        if (
          json?.data?.node &&
          json?.path
        ) {
          const path = json.path;
          if (
            Array.isArray(path) &&
            path[0] === "node" &&
            path[1] === "group_feed" &&
            path[2] === "edges" &&
            path.length === 4
          ) {
            allNodes.push({
              node: json.data.node,
              cursor: json.data.cursor,
            });
          }
        }
      } catch (_) {
        // Skip unparseable chunks
      }
    }

    console.log(
      "[getFeedPostsGraphQL] parsed nodes:",
      allNodes.length,
      "types:",
      allNodes.map(
        (n) => n.node?.__typename,
      ),
    );

    // Filter out non-Story nodes (e.g. GroupsSectionHeaderUnit)
    const storyEdges = allNodes.filter(
      (e) =>
        e.node?.__typename === "Story",
    );

    const posts: FeedPost[] =
      storyEdges.map((e: any) => {
        const node = e.node || {};
        // Get message text from nested comet_sections
        const storyContent =
          node.comet_sections?.content
            ?.story;
        const messageText =
          storyContent?.message?.text ??
          node.message?.text ??
          "";

        // Get author info
        const actors =
          storyContent?.actors ||
          node.actors ||
          [];
        const actor = actors[0] || {};

        // Get creation_time from timestamp metadata
        const metadataArr =
          node.comet_sections
            ?.context_layout?.story
            ?.comet_sections
            ?.metadata || [];
        let creationTime = 0;
        for (const meta of metadataArr) {
          if (
            meta?.story?.creation_time
          ) {
            creationTime =
              meta.story.creation_time;
            break;
          }
        }

        // Track last cursor for pagination
        if (e.cursor)
          lastCursor = e.cursor;

        return {
          id: node.id || "",
          post_id:
            node.post_id ||
            storyContent?.post_id ||
            "",
          message: messageText,
          created_time: creationTime
            ? new Date(
                creationTime * 1000,
              ).toISOString()
            : "",
          author_name: actor.name || "",
          author_id: actor.id || "",
        };
      });

    return {
      success: true,
      posts,
      cursor: lastCursor,
      hasNextPage:
        storyEdges.length >= count,
    };
  } catch (err) {
    if (
      err instanceof DOMException &&
      err.name === "AbortError"
    ) throw err;
    console.error(
      "getFeedPostsGraphQL error:",
      err,
    );
    return {
      success: false,
      message: String(err),
    };
  }
}

// ─── Feed Cleaner (token-based or cookie-based) ───
async function runPostCleaner(
  config: CleanerConfig,
  token: string,
  groupId: string,
): Promise<void> {
  cleanerAbortController =
    new AbortController();
  const signal =
    cleanerAbortController.signal;

  const keywords = config.keywords
    ? config.keywords
        .split(",")
        .map((k) =>
          k.trim().toLowerCase(),
        )
        .filter(Boolean)
    : [];
  const fromDate = config.fromDate
    ? new Date(config.fromDate)
    : null;
  const useGraphQL = !token.trim();

  sendLog(
    `Bộ lọc: ${keywords.length > 0 ? `từ khóa=[${keywords.join(", ")}]` : "không lọc từ khóa"}, tối đa=${config.maxPosts}${fromDate ? `, từ ngày=${config.fromDate}` : ""}`,
  );
  sendLog(`ID Nhóm: ${groupId}`);
  sendLog(
    useGraphQL
      ? "🔑 Không có token — sử dụng GraphQL API qua cookie"
      : "🔑 Sử dụng Graph API qua Access Token",
  );

  let deletedCount = 0;
  let scannedCount = 0;
  let fetchAttempts = 0;
  const processedPosts =
    new Set<string>();

  try {
    if (useGraphQL) {
      // ── Cookie-based GraphQL approach ──
      let cursor: string | null = null;

      while (
        deletedCount < config.maxPosts
      ) {
        checkAbort(signal);

        fetchAttempts++;
        sendLog(
          `Đang lấy bảng tin qua GraphQL (trang ${fetchAttempts})...`,
        );

        const result =
          await getFeedPostsGraphQL(
            groupId,
            5,
            cursor,
          );
        if (!result.success) {
          sendLog(
            `Lỗi lấy dữ liệu bảng tin: ${result.message}`,
            "error",
          );
          sendDone("Thất bại.");
          return;
        }

        const posts =
          result.posts ?? [];
        if (posts.length === 0) {
          sendLog(
            "Không tìm thấy thêm bài viết nào.",
            "warning",
          );
          break;
        }

        // Check for new posts
        const newPosts = posts.filter(
          (p) =>
            !processedPosts.has(
              p.post_id,
            ),
        );
        if (newPosts.length === 0) {
          sendLog(
            "Tất cả bài viết trả về đều đã được xử lý.",
            "warning",
          );
          break;
        }

        sendLog(
          `Đã lấy được ${posts.length} bài viết.`,
        );

        for (const post of posts) {
          checkAbort(signal);
          if (
            deletedCount >=
            config.maxPosts
          )
            break;
          if (
            processedPosts.has(
              post.post_id,
            )
          )
            continue;

          processedPosts.add(
            post.post_id,
          );
          scannedCount++;

          const postText = (
            post.message || ""
          ).toLowerCase();

          // Keyword filter
          if (
            !matchesKeywords(
              postText,
              keywords,
            )
          )
            continue;

          // Date filter
          if (
            fromDate &&
            post.created_time
          ) {
            const postDate = new Date(
              post.created_time,
            );
            if (postDate < fromDate) {
              sendLog(
                `Bài viết ${scannedCount}: cũ hơn ngày bắt đầu, bỏ qua.`,
              );
              continue;
            }
          }

          const preview =
            postText
              .slice(0, 60)
              .replace(/\n/g, " ") ||
            "(không có nội dung)";
          sendLog(
            `Bài viết ${scannedCount}: "${preview}…" bởi ${post.author_name || "không rõ"} — đang xóa...`,
          );

          // The id from GraphQL is already the story ID
          const deleteResult =
            await apiDeletePost(
              post.id,
            );
          if (!deleteResult.success) {
            sendLog(
              `Failed to delete post ${scannedCount}: ${deleteResult.message}`,
              "error",
            );
            continue;
          }

          deletedCount++;
          sendLog(
            `✓ Bài viết ${scannedCount} đã được xóa! (${deletedCount}/${config.maxPosts})`,
            "success",
          );
          await delay(
            800 + Math.random() * 500,
            signal,
          );
        }

        // if (
        //   !result.hasNextPage ||
        //   !result.cursor
        // )
        //   break;
        // cursor = result.cursor;
      }
    } else {
      // ── Token-based Graph API approach (original) ──
      let nextUrl: string | null =
        `https://graph.facebook.com/v22.0/${groupId}/feed?access_token=${token}&limit=50`;

      while (
        deletedCount <
          config.maxPosts &&
        nextUrl
      ) {
        checkAbort(signal);

        fetchAttempts++;
        sendLog(
          `Đang lấy bảng tin từ Graph API (trang ${fetchAttempts})...`,
        );

        let articles: any[] = [];
        try {
          const response = await fetch(
            nextUrl,
            {
              method: "GET",
              credentials: "include",
              signal,
              headers: {
                accept: "*/*",
                "content-type":
                  "application/x-www-form-urlencoded",
                origin:
                  "https://developers.facebook.com",
                referer:
                  "https://developers.facebook.com/",
              },
            },
          );
          const data =
            await response.json();

          articles = data.data || [];

          if (articles.length === 0) {
            sendLog(
              "Không tìm thấy bài viết nào từ API.",
              "warning",
            );
            break;
          }

          const newPosts =
            articles.filter(
              (p: any) =>
                !processedPosts.has(
                  p.id,
                ),
            );
          if (newPosts.length === 0) {
            sendLog(
              "Tất cả bài viết trả về đều đã được xử lý. Không có bài mới để quét.",
              "warning",
            );
            break;
          }
        } catch (err) {
          if (
            err instanceof
              DOMException &&
            err.name === "AbortError"
          )
            throw err;
          sendLog(
            `Lỗi khi lấy dữ liệu API: ${err}`,
            "error",
          );
          sendDone(
            "Thất bại: Lỗi Graph API.",
          );
          return;
        }

        for (const post of articles) {
          checkAbort(signal);
          if (
            deletedCount >=
            config.maxPosts
          )
            break;

          const postIdRaw = post.id;
          if (
            processedPosts.has(
              postIdRaw,
            )
          )
            continue;

          processedPosts.add(postIdRaw);
          scannedCount++;

          const postText = (
            post.message ||
            post.story ||
            ""
          ).toLowerCase();

          // Keyword filter
          if (
            !matchesKeywords(
              postText,
              keywords,
            )
          )
            continue;

          // Date filter
          if (fromDate) {
            const postDate = new Date(
              post.updated_time,
            );
            if (postDate < fromDate) {
              sendLog(
                `Bài viết ${scannedCount}: cũ hơn ngày bắt đầu, bỏ qua.`,
              );
              continue;
            }
            sendLog(
              `Bài viết ${scannedCount}: khớp từ khóa, đang xóa...`,
            );
          } else {
            const preview = postText
              .slice(0, 60)
              .replace(/\n/g, " ");
            sendLog(
              `Bài viết ${scannedCount}: khớp "${preview}..."`,
            );
          }

          // Get story ID
          const postIdParts =
            postIdRaw.split("_");
          const postId =
            postIdParts.length > 1
              ? postIdParts[1]
              : postIdRaw;
          const actorId = getUserID();
          const storyId =
            actorId && postId
              ? btoa(
                  `S:_I${actorId}:VK:${postId}`,
                )
              : null;

          if (!storyId) {
            sendLog(
              `Không thể xác định story ID cho bài viết ${scannedCount}, bỏ qua.`,
              "warning",
            );
            continue;
          }

          sendLog(
            `Đang xóa bài viết ${scannedCount} qua API...`,
          );
          const deleteResult =
            await apiDeletePost(
              storyId,
            );

          if (!deleteResult.success) {
            sendLog(
              `Failed to delete post ${scannedCount}: ${deleteResult.message}`,
              "error",
            );
            continue;
          }

          deletedCount++;
          sendLog(
            `✓ Bài viết ${scannedCount} đã được xóa! (${deletedCount}/${config.maxPosts})`,
            "success",
          );
          await delay(
            800 + Math.random() * 500,
            signal,
          );
        }
      }
    }

    sendDone(
      `Hoàn tất! Đã xóa ${deletedCount} bài viết, quét ${scannedCount} bài viết.`,
    );
  } catch (err) {
    if (
      err instanceof DOMException &&
      err.name === "AbortError"
    ) {
      sendDone(
        `Đã dừng. Đã xóa ${deletedCount} bài viết.`,
      );
    } else {
      sendLog(`Lỗi: ${err}`, "error");
      sendDone("Thất bại.");
    }
  }
}

// ─── Pending Cleaner ───
async function runPendingCleaner(
  config: CleanerConfig,
  groupId: string,
): Promise<void> {
  cleanerAbortController =
    new AbortController();
  const signal =
    cleanerAbortController.signal;

  const keywords = config.keywords
    ? config.keywords
        .split(",")
        .map((k) =>
          k.trim().toLowerCase(),
        )
        .filter(Boolean)
    : [];

  sendLog(
    `[Đang chờ] Bộ lọc: ${keywords.length > 0 ? `từ khóa=[${keywords.join(", ")}]` : "không lọc"}, tối đa=${config.maxPosts}`,
  );
  sendLog(
    `[Đang chờ] ID Nhóm: ${groupId}`,
  );

  let deletedCount = 0;
  let scannedCount = 0;
  let cursor: string | null = null;

  try {
    while (
      deletedCount < config.maxPosts
    ) {
      checkAbort(signal);

      sendLog(
        `Đang lấy bài viết đang chờ…`,
      );
      const result =
        await getPendingPosts(
          groupId,
          20,
          cursor,
        );
      if (!result.success) {
        sendLog(
          `Lỗi khi lấy dữ liệu: ${result.message}`,
          "error",
        );
        sendDone("Thất bại.");
        return;
      }

      const posts = result.posts ?? [];
      if (posts.length === 0) {
        sendLog(
          "Không tìm thấy thêm bài viết đang chờ duyệt nào.",
          "warning",
        );
        break;
      }

      for (const post of posts) {
        checkAbort(signal);
        if (
          deletedCount >=
          config.maxPosts
        )
          break;

        scannedCount++;
        const postText =
          post.message.toLowerCase();

        if (
          !matchesKeywords(
            postText,
            keywords,
          )
        ) {
          sendLog(
            `Bài viết ${scannedCount}: không khớp từ khóa, bỏ qua.`,
          );
          continue;
        }

        const preview = postText
          .slice(0, 60)
          .replace(/\n/g, " ");
        sendLog(
          `Bài viết ${scannedCount}: “${preview}…” — đang xóa...`,
        );

        // story_id từ pending GraphQL đã ở dạng chuẩn
        const deleteResult =
          await apiDeletePost(post.id);
        if (!deleteResult.success) {
          sendLog(
            `Lỗi khi xóa bài viết ${scannedCount}: ${deleteResult.message}`,
            "error",
          );
          continue;
        }

        deletedCount++;
        sendLog(
          `✓ Đã xóa bài viết đang chờ ${scannedCount}! (${deletedCount}/${config.maxPosts})`,
          "success",
        );
        await delay(
          800 + Math.random() * 500,
          signal,
        );
      }

      if (
        !result.hasNextPage ||
        !result.cursor
      )
        break;
      cursor = result.cursor;
    }

    sendDone(
      `Hoàn tất! Đã xóa ${deletedCount} bài viết đang chờ, quét tổng cộng ${scannedCount} bài.`,
    );
  } catch (err) {
    if (
      err instanceof DOMException &&
      err.name === "AbortError"
    ) {
      sendDone(
        `Đã dừng. Đã xóa ${deletedCount} bài viết đang chờ.`,
      );
    } else {
      sendLog(`Lỗi: ${err}`, "error");
      sendDone("Thất bại.");
    }
  }
}

// ─── Spam Posts (Modmin Review Folder) ───
interface SpamPost {
  id: string; // story ID (base64 encoded)
  post_id: string; // numeric post ID
  contentType: string; // e.g. GROUP_POST
  message: string;
  created_time: string;
  author_name: string;
  author_id: string;
}

async function getSpamPosts(
  groupId: string,
  count: number = 10,
  cursor: string | null = null,
): Promise<{
  success: boolean;
  posts?: SpamPost[];
  cursor?: string | null;
  hasNextPage?: boolean;
  message?: string;
}> {
  const fb_dtsg = getFBDTSG();
  const av = getUserID();

  if (!fb_dtsg || !av) {
    return {
      success: false,
      message:
        "Thiếu token (fb_dtsg hoặc av)",
    };
  }

  try {
    const variables: Record<
      string,
      any
    > = {
      contentType: null,
      count,
      cursor: cursor ?? null,
      feedLocation:
        "GROUPS_MODMIN_REVIEW_FOLDER",
      feedbackSource: 0,
      focusCommentID: null,
      privacySelectorRenderLocation:
        "COMET_STREAM",
      referringStoryRenderLocation:
        null,
      renderLocation:
        "groups_modmin_review_folder",
      scale: 1,
      searchTerm: null,
      useDefaultActor: false,
      id: groupId,
      __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
      __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
      __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
      __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: false,
      __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
      __relay_internal__pv__IsWorkUserrelayprovider: false,
      __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
      __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
      __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
      __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
      __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
      __relay_internal__pv__IsMergQAPollsrelayprovider: false,
      __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
      __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
      __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider:
        "ORIGINAL",
      __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
      __relay_internal__pv__CometUFISingleLineUFIrelayprovider: true,
      __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
      __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
      __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
      __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
      __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: true,
    };

    const signal = getCleanerSignal();
    const res = await fetch(
      "https://www.facebook.com/api/graphql/",
      {
        method: "POST",
        credentials: "include",
        signal,
        headers: {
          "content-type":
            "application/x-www-form-urlencoded",
          "x-fb-friendly-name":
            "GroupsCometModminReviewFolderContentContainerQuery",
        },
        body: new URLSearchParams({
          av: av,
          __user: av,
          __a: "1",
          fb_dtsg: fb_dtsg,
          fb_api_caller_class:
            "RelayModern",
          fb_api_req_friendly_name:
            "GroupsCometModminReviewFolderContentContainerQuery",
          server_timestamps: "true",
          variables:
            JSON.stringify(variables),
          doc_id: "34904810272499153",
        }),
      },
    );

    const text = await res.text();

    // Facebook may return multiple JSON lines (ndjson)
    const firstLine =
      text.split("\n")[0];
    const data = JSON.parse(firstLine);

    console.log(
      "[getSpamPosts] raw response:",
      text.slice(0, 800),
    );

    if (data?.errors) {
      const errMsg =
        data.errors[0]?.message ||
        "Lỗi GraphQL";
      console.error(
        "[getSpamPosts] errors:",
        data.errors,
      );
      return {
        success: false,
        message: errMsg,
      };
    }

    const folder =
      data?.data?.node
        ?.modmin_review_folder;
    const edges: any[] =
      folder?.edges || [];
    const pageInfo =
      folder?.page_info || {};

    const posts: SpamPost[] = edges.map(
      (e: any) => {
        const node = e.node || {};
        // Get message from the story content - try multiple paths
        const storyContent =
          node.comet_sections?.content
            ?.story;
        const messageText =
          storyContent?.message?.text ??
          storyContent?.comet_sections
            ?.message?.story?.message
            ?.text ??
          node.message?.text ??
          "";

        // Get author info from feedback.owning_profile or actors
        const owningProfile =
          node.feedback
            ?.owning_profile || {};
        const actor =
          storyContent?.actors?.[0] ||
          {};

        return {
          id: node.id || "",
          post_id:
            node.post_id ||
            storyContent?.post_id ||
            "",
          contentType:
            node.group_reportable_type ||
            "GROUP_POST",
          message: messageText,
          created_time:
            storyContent?.creation_time
              ? new Date(
                  storyContent.creation_time *
                    1000,
                ).toISOString()
              : node.creation_time
                ? new Date(
                    node.creation_time *
                      1000,
                  ).toISOString()
                : "",
          author_name:
            owningProfile.name ||
            actor.name ||
            "",
          author_id:
            owningProfile.id ||
            actor.id ||
            "",
        };
      },
    );

    return {
      success: true,
      posts,
      cursor:
        pageInfo.end_cursor ??
        edges[edges.length - 1]
          ?.cursor ??
        null,
      hasNextPage:
        pageInfo.has_next_page ??
        edges.length >= count,
    };
  } catch (err) {
    if (
      err instanceof DOMException &&
      err.name === "AbortError"
    ) throw err;
    console.error(
      "getSpamPosts error:",
      err,
    );
    return {
      success: false,
      message: String(err),
    };
  }
}

// ─── Decline Spam Post (Modmin Review Folder) ───
async function apiDeclineSpamPost(
  groupId: string,
  storyId: string,
  memberId: string,
  contentType: string = "GROUP_POST",
): Promise<{
  success: boolean;
  message: string;
}> {
  const fb_dtsg = getFBDTSG();
  const av = getUserID();

  if (!fb_dtsg || !av) {
    return {
      success: false,
      message:
        "Thiếu token (fb_dtsg hoặc av)",
    };
  }

  console.log("Declining spam post:", {
    groupId,
    storyId,
    memberId,
    contentType,
  });

  try {
    const signal = getCleanerSignal();
    const res = await fetch(
      "https://www.facebook.com/api/graphql/",
      {
        method: "POST",
        credentials: "include",
        signal,
        headers: {
          "content-type":
            "application/x-www-form-urlencoded",
          "x-fb-friendly-name":
            "GroupsCometModminReviewFolderDeclineContentMutation",
        },
        body: new URLSearchParams({
          av: av,
          __user: av,
          __a: "1",
          fb_dtsg: fb_dtsg,
          fb_api_caller_class:
            "RelayModern",
          fb_api_req_friendly_name:
            "GroupsCometModminReviewFolderDeclineContentMutation",
          server_timestamps: "true",
          variables: JSON.stringify({
            input: {
              action_source:
                "GROUP_MODMIN_REVIEW_FOLDER",
              group_id: groupId,
              story_id: storyId,
              actor_id: av,
              client_mutation_id:
                Math.floor(
                  Math.random() * 1000,
                ).toString(),
            },
            contentType,
            member_id: memberId,
          }),
          doc_id: "30216535437945305",
        }),
      },
    );

    const text = await res.text();
    console.log(
      "Decline spam response:",
      text.slice(0, 500),
    );

    if (text.includes('"errors"')) {
      const parsed = JSON.parse(text);
      const errorMsg =
        parsed.errors?.[0]?.message ||
        "Lỗi GraphQL không xác định";
      return {
        success: false,
        message: errorMsg,
      };
    }
    return {
      success: true,
      message:
        "Đã từ chối bài viết spam thành công",
    };
  } catch (err) {
    if (
      err instanceof DOMException &&
      err.name === "AbortError"
    ) throw err;
    console.error(
      "Decline spam error:",
      err,
    );
    return {
      success: false,
      message: String(err),
    };
  }
}

// ─── Spam Cleaner ───
async function runSpamCleaner(
  config: CleanerConfig,
  groupId: string,
): Promise<void> {
  cleanerAbortController =
    new AbortController();
  const signal =
    cleanerAbortController.signal;

  const keywords = config.keywords
    ? config.keywords
        .split(",")
        .map((k) =>
          k.trim().toLowerCase(),
        )
        .filter(Boolean)
    : [];

  sendLog(
    `[Spam] Bộ lọc: ${keywords.length > 0 ? `từ khóa=[${keywords.join(", ")}]` : "không lọc (xóa tất cả)"}, tối đa=${config.maxPosts}`,
  );
  sendLog(`[Spam] ID Nhóm: ${groupId}`);

  let deletedCount = 0;
  let scannedCount = 0;
  let cursor: string | null = null;

  try {
    while (
      deletedCount < config.maxPosts
    ) {
      checkAbort(signal);

      sendLog(
        `Đang lấy bài viết spam…`,
      );
      const result = await getSpamPosts(
        groupId,
        10,
        cursor,
      );
      if (!result.success) {
        sendLog(
          `Lỗi khi lấy bài viết spam: ${result.message}`,
          "error",
        );
        sendDone("Thất bại.");
        return;
      }

      const posts = result.posts ?? [];
      if (posts.length === 0) {
        sendLog(
          "Không tìm thấy thêm bài viết spam nào.",
          "warning",
        );
        break;
      }

      sendLog(
        `Đã lấy được ${posts.length} bài viết spam.`,
      );

      for (const post of posts) {
        checkAbort(signal);
        if (
          deletedCount >=
          config.maxPosts
        )
          break;

        scannedCount++;
        const postText = (
          post.message || ""
        ).toLowerCase();

        if (
          !matchesKeywords(
            postText,
            keywords,
          )
        ) {
          const preview =
            postText
              .slice(0, 40)
              .replace(/\n/g, " ") ||
            "(không có nội dung)";
          sendLog(
            `Bài viết ${scannedCount}: không khớp từ khóa, bỏ qua. "${preview}…"`,
          );
          continue;
        }

        const preview =
          postText
            .slice(0, 60)
            .replace(/\n/g, " ") ||
          "(không có nội dung)";
        sendLog(
          `Bài viết ${scannedCount}: "${preview}…" bởi ${post.author_name || "không rõ"} — đang từ chối...`,
        );

        const declineResult =
          await apiDeclineSpamPost(
            groupId,
            post.id,
            post.author_id,
            post.contentType,
          );
        if (!declineResult.success) {
          sendLog(
            `Lỗi từ chối bài viết spam ${scannedCount}: ${declineResult.message}`,
            "error",
          );
          continue;
        }

        deletedCount++;
        sendLog(
          `✓ Đã từ chối bài viết spam ${scannedCount}! (${deletedCount}/${config.maxPosts})`,
          "success",
        );
        await delay(
          800 + Math.random() * 500,
          signal,
        );
      }

      if (
        !result.hasNextPage ||
        !result.cursor
      )
        break;
      cursor = result.cursor;
    }

    sendDone(
      `Hoàn tất! Đã từ chối ${deletedCount} bài viết spam, quét tổng cộng ${scannedCount} bài.`,
    );
  } catch (err) {
    if (
      err instanceof DOMException &&
      err.name === "AbortError"
    ) {
      sendDone(
        `Đã dừng. Đã từ chối ${deletedCount} bài viết spam.`,
      );
    } else {
      sendLog(`Lỗi: ${err}`, "error");
      sendDone("Thất bại.");
    }
  }
}

// ─── Message Listener ───
chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    if (message.type === "PING") {
      sendResponse({ ok: true });
      return;
    }

    if (
      message.type === "SET_FONT_SIZE"
    ) {
      applyFontSize(message.size);
      sendResponse({ ok: true });
    }

    if (
      message.type === "GET_GROUP_ID"
    ) {
      const html =
        document.documentElement
          .innerHTML;
      // Search for groupID patterns in the page source
      const patterns = [
        /"groupID"\s*:\s*"(\d+)"/,
        /"group_id"\s*:\s*"(\d+)"/,
        /\/groups\/(\d+)/,
        /"groupId"\s*:\s*"(\d+)"/,
      ];
      let foundGroupId: string | null =
        null;
      for (const pattern of patterns) {
        const match =
          html.match(pattern);
        if (match?.[1]) {
          foundGroupId = match[1];
          break;
        }
      }
      sendResponse({
        groupId: foundGroupId,
      });
      return;
    }

    if (
      message.type ===
      "START_POST_CLEANER"
    ) {
      sendResponse({ ok: true });
      runPostCleaner(
        message.config as CleanerConfig,
        message.token as string,
        message.groupId as string,
      );
    }

    if (
      message.type ===
      "START_PENDING_CLEANER"
    ) {
      sendResponse({ ok: true });
      runPendingCleaner(
        message.config as CleanerConfig,
        message.groupId as string,
      );
    }

    if (
      message.type ===
      "START_SPAM_CLEANER"
    ) {
      sendResponse({ ok: true });
      runSpamCleaner(
        message.config as CleanerConfig,
        message.groupId as string,
      );
    }

    if (
      message.type ===
      "STOP_POST_CLEANER"
    ) {
      cleanerAbortController?.abort();
      sendResponse({ ok: true });
      return;
    }

    if (
      message.type ===
      "TEST_DELETE_POST"
    ) {
      const actorId = getUserID();
      if (!actorId) {
        sendResponse({
          success: false,
          message:
            "Không tìm thấy ID người dùng",
        });
        return;
      }

      let postId = message.postId;
      // Extract short ID if formatted as "groupid_postid"
      if (postId.includes("_")) {
        postId = postId.split("_")[1];
      }

      // Use refined Comet story ID format: S:_I<uid>:VK:<pid>
      const storyId = btoa(
        `S:_I${actorId}:VK:${postId}`,
      );
      apiDeletePost(storyId).then(
        sendResponse,
      );
      return true;
    }

    if (message.type === "LIKE_POST") {
      likePost(message.feedbackId).then(
        sendResponse,
      );
      return true; // Keep channel open for async response
    }

    if (
      message.type ===
      "GET_PENDING_POSTS"
    ) {
      getPendingPosts(
        message.groupId as string,
        (message.count as number) || 20,
        (message.cursor as
          | string
          | null) || null,
      ).then(sendResponse);
      return true; // Keep channel open for async response
    }

    if (
      message.type === "GET_SPAM_POSTS"
    ) {
      getSpamPosts(
        message.groupId as string,
        (message.count as number) || 10,
        (message.cursor as
          | string
          | null) || null,
      ).then(sendResponse);
      return true; // Keep channel open for async response
    }
  },
);
