export const ensureContentScript = async (tabId: number): Promise<boolean> => {
  try {
    // Try pinging the content script first
    await chrome.tabs.sendMessage(tabId, { type: 'PING' })
    return true
  } catch {
    // Content script not loaded, inject it programmatically
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/main.ts-loader.js'],
      })
      // Wait for script to initialize
      await new Promise((r) => setTimeout(r, 500))
      return true
    } catch (err) {
      console.error(`Failed to inject script: ${err}`)
      return false
    }
  }
}

export const likePost = async (feedbackId: string = "ZmVlZGJhY2s6MTg3NTIzMDYwOTkwNDQxNg=="): Promise<{ success: boolean; message: string }> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { success: false, message: "No active tab found" };
  }

  const ready = await ensureContentScript(tab.id);
  if (!ready) {
    return { success: false, message: "Could not load content script. Try refreshing the page." };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'LIKE_POST', feedbackId });
    return response || { success: false, message: "No response from content script" };
  } catch (error) {
    return { success: false, message: `Failed to communicate with page: ${error}` };
  }
}

export const deletePost = async (postId: string): Promise<{ success: boolean; message: string }> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { success: false, message: "No active tab found" };
  }

  const ready = await ensureContentScript(tab.id);
  if (!ready) {
    return { success: false, message: "Could not load content script. Try refreshing the page." };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'TEST_DELETE_POST', postId });
    return response || { success: false, message: "No response from content script" };
  } catch (error) {
    return { success: false, message: `Failed to communicate with page: ${error}` };
  }
}


