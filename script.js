document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENTS ---
    const userInput = document.getElementById('userInput');
    const aiOutput = document.getElementById('aiOutput');
    const logButton = document.getElementById('logButton');
    const instructionText = document.getElementById('instructionText');
    const logModal = document.getElementById('logModal');
    const closeModalButton = document.querySelector('.close-button');
    const logContainer = document.getElementById('logContainer');
    const modelSwitch = document.getElementById('modelSwitch');
    const downloadLogButton = document.getElementById('downloadLogButton');
    const quickActionsDropdown = document.getElementById('quickActionsDropdown');

    // --- CONFIGURATION & STATE ---
    const DEBOUNCE_MS = 350; // Slightly increased for more complex logic
    const WORKER_URL = 'https://lnkino-api.maxzitek8.workers.dev';
    let debounceTimer;
    let abortController = new AbortController();
    let apiCallLog = [];
    let currentCallData = {};
    let lockedTextState = "";
    const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);


    // --- INITIALIZATION ---
    setupUIForDevice();


    // --- EVENT LISTENERS ---
    userInput.addEventListener('input', handleUserInput);
    downloadLogButton.addEventListener('click', downloadLog);
    logButton.addEventListener('click', openModal);
    closeModalButton.addEventListener('click', closeModal);
    quickActionsDropdown.addEventListener('click', handleQuickActionClick);
    window.addEventListener('click', (event) => {
        if (event.target == logModal) closeModal();
    });

    function setupUIForDevice() {
        if (isMobile) {
            instructionText.textContent = 'Tap a suggestion to accept it.';
            aiOutput.addEventListener('click', (e) => {
                if (e.target.classList.contains('active-paragraph-mobile')) {
                    e.target.classList.add('tapped');
                    e.target.addEventListener('animationend', () => {
                        e.target.classList.remove('tapped');
                    }, { once: true });
                    acceptAISuggestion();
                }
            });
        } else {
            userInput.addEventListener('keydown', handleKeydown);
        }
    }


    // --- CORE FUNCTIONS ---
    function handleKeydown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            acceptAISuggestion();
        }
    }

function acceptAISuggestion() {
    // Find only the active, new suggestion
    const activeSuggestionEl = aiOutput.querySelector('.active-paragraph, .active-paragraph-mobile');

    // Make sure there's actually a suggestion to accept
    if (!activeSuggestionEl || !activeSuggestionEl.textContent.trim()) {
        return;
    }

    const suggestionText = activeSuggestionEl.textContent;

    // Stop any streams that are still running
    abortController.abort();
    abortController = new AbortController();
    clearTimeout(debounceTimer);

    // Correctly build the new text by combining the old locked state with the new suggestion
    const newFullText = (lockedTextState ? lockedTextState + '\n\n' : '') + suggestionText;

    // Update the user's text area and the locked state
    userInput.value = newFullText + '\n\n';
    lockedTextState = newFullText.trim();

    // Re-render the AI pane with the now-locked text and remove the old active suggestion
    renderLockedContent(lockedTextState);
    const currentActiveEl = aiOutput.querySelector('.active-paragraph, .active-paragraph-mobile');
    if (currentActiveEl) {
        currentActiveEl.remove();
    }

    // Place the cursor at the end of the text
    userInput.focus();
    userInput.setSelectionRange(userInput.value.length, userInput.value.length);
}

    // --- REWRITTEN: Core Input and Unlocking Logic ---
    function handleUserInput() {
        // 1. Immediately check if the user is editing a locked area.
        const cursorPosition = userInput.selectionStart;
        const lastLength = lockedTextState.length;

        // If the cursor is inside the locked text and the text has changed
        if (cursorPosition <= lastLength && userInput.value !== lockedTextState) {
            // Find the beginning of the paragraph the user is editing.
            // We search backwards from the cursor for a double newline.
            const textBeforeCursor = userInput.value.substring(0, cursorPosition);
            let paragraphStartIndex = textBeforeCursor.lastIndexOf('\n\n');

            // If found, the start is after the double newline. If not, it's the beginning.
            paragraphStartIndex = (paragraphStartIndex === -1) ? 0 : paragraphStartIndex + 2;
            
            // 2. Break the lock from that point forward.
            lockedTextState = userInput.value.substring(0, paragraphStartIndex).trim();
        }

        // 3. Continue with the standard debounced AI trigger.
        abortController.abort();
        abortController = new AbortController();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(triggerAI, DEBOUNCE_MS);
    }

    async function triggerAI() {
        // This function now has a simpler job. The lockedTextState is already correct.
        const fullText = userInput.value;
        const activeText = fullText.substring(lockedTextState.length).trim();

        renderLockedContent(lockedTextState);

        if (!activeText) {
            const activeElement = aiOutput.querySelector('.active-paragraph, .active-paragraph-mobile');
            if (activeElement) activeElement.remove();
            return;
        }

        let activeElement = aiOutput.querySelector('.active-paragraph, .active-paragraph-mobile');
        if (!activeElement) {
            activeElement = document.createElement('div');
            activeElement.className = isMobile ? 'active-paragraph-mobile' : 'active-paragraph';
            aiOutput.appendChild(activeElement);
        }
        activeElement.textContent = '...';

        let fullResponse = "";
        const model = modelSwitch.checked ? 'gpt-4o' : 'gpt-4o-mini';
        currentCallData = { timestamp: new Date(), input: { lockedText: lockedTextState, activeText }, model: model };

        try {
            const response = await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lockedText: lockedTextState, activeText, model }),
                signal: abortController.signal,
            });

            if (!response.ok) throw new Error(`Worker error: ${response.statusText}`);
            if (!response.body) throw new Error("Response body is missing.");

            const systemPromptHeader = response.headers.get('X-System-Prompt');
            currentCallData.systemPrompt = systemPromptHeader ? decodeURIComponent(systemPromptHeader) : 'N/A';
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.substring(6);
                        if (data.trim() === '[DONE]') continue;
                        try {
                            const json = JSON.parse(data);
                            if (json.usage) {
                                currentCallData.usage = json.usage;
                            } else {
                                const token = json.choices[0]?.delta?.content || "";
                                if (token) {
                                    fullResponse += token;
                                    activeElement.textContent = fullResponse;
                                }
                            }
                        } catch (e) { /* Ignore parsing errors */ }
                    }
                }
            }
            logApiCall(fullResponse);
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Error calling AI:', error);
                activeElement.textContent = "Error connecting to the assistant.";
            }
        }
    }

    function renderLockedContent(lockedContent) {
        aiOutput.innerHTML = '';
        const paragraphs = lockedContent.split('\n\n');
        paragraphs.forEach(pText => {
            if (pText.trim()) {
                const pElement = document.createElement('div');
                pElement.className = 'locked-paragraph';
                pElement.textContent = pText;
                aiOutput.appendChild(pElement);
            }
        });
    }

    // --- QUICK ACTION HANDLER ---
    async function handleQuickActionClick(e) {
        e.preventDefault();
        if (e.target.tagName !== 'A') return;

        const action = e.target.dataset.action;
        const fullText = userInput.value;

        if (!fullText.trim()) {
            alert("There's no text to rewrite.");
            return;
        }

        abortController.abort();
        abortController = new AbortController();
        clearTimeout(debounceTimer);

        aiOutput.innerHTML = `<div class="active-paragraph">Performing action: "${action}"...</div>`;
        userInput.disabled = true;

        try {
            const model = modelSwitch.checked ? 'gpt-4o' : 'gpt-4o-mini';
            const response = await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fullText, action, model }),
            });

            if (!response.ok) {
                throw new Error(`Worker error: ${response.statusText}`);
            }

            const data = await response.json();
            const { rewrittenText } = data;

            userInput.value = rewrittenText;
            lockedTextState = rewrittenText.trim();
            
            renderLockedContent(lockedTextState);

        } catch (error) {
            console.error('Quick Action failed:', error);
            renderLockedContent(fullText);
            aiOutput.innerHTML += `<div class="active-paragraph" style="color: #ff5555;">Error performing action. Please try again.</div>`;
        } finally {
            userInput.disabled = false;
            userInput.focus();
        }
    }

    // --- LOGGING & MODAL FUNCTIONS ---
    function logApiCall(response) {
        const callData = { ...currentCallData, output: response };
        apiCallLog.unshift(callData);
        currentCallData = {};
    }

    function openModal() {
        renderLog();
        logModal.style.display = 'block';
    }

    function closeModal() {
        logModal.style.display = 'none';
    }

    function renderLog() {
        logContainer.innerHTML = '';
        const totalCalls = apiCallLog.length;
        document.getElementById('totalCalls').textContent = totalCalls;

        if (totalCalls === 0) {
            logContainer.innerHTML = '<p>No API calls made yet in this session.</p>';
            return;
        }

        apiCallLog.forEach((call, index) => {
            const entryDiv = document.createElement('div');
            entryDiv.className = 'log-entry';
            const usageText = call.usage ? `Prompt: ${call.usage.prompt_tokens} | Completion: ${call.usage.completion_tokens} | Total: ${call.usage.total_tokens}` : 'N/A';
            entryDiv.innerHTML = `
                <div class="log-entry-header">
                    <span><strong>Call #${totalCalls - index}</strong> | ${call.timestamp.toLocaleTimeString()}</span>
                    <span><strong>Model:</strong> ${call.model} | <strong>Tokens:</strong> ${usageText}</span>
                </div>
                <div class="log-entry-body">
                    <div class="log-section-title">System Prompt Sent</div>
                    <pre>${call.systemPrompt || 'N/A'}</pre>
                    <div class="log-section-title">User Input Sent</div>
                    <pre>---LOCKED---\n${call.input.lockedText}\n---ACTIVE---\n${call.input.activeText}</pre>
                    <div class="log-section-title">AI Output Received</div>
                    <pre>${call.output}</pre>
                </div>`;
            logContainer.appendChild(entryDiv);
        });
    }

    function downloadLog() {
        if (apiCallLog.length === 0) {
            alert("No log data to download.");
            return;
        }
        const logData = JSON.stringify(apiCallLog, null, 2);
        const blob = new Blob([logData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.download = `kinotype-log-${timestamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
});