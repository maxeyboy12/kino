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
    const quickActionsButton = document.getElementById('quickActionsButton');
    const quickActionsDropdown = document.getElementById('quickActionsDropdown');

    // --- CONFIGURATION & STATE ---
    const DEBOUNCE_MS = 350;
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
    
    // Listeners for the new JS-powered dropdown
    quickActionsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        quickActionsDropdown.parentElement.classList.toggle('is-active');
    });
    quickActionsDropdown.addEventListener('click', handleQuickActionClick);

    window.addEventListener('click', (event) => {
        if (event.target == logModal) closeModal();
        if (!event.target.closest('.dropdown')) {
            quickActionsDropdown.parentElement.classList.remove('is-active');
        }
    });

    function setupUIForDevice() {
        if (isMobile) {
            instructionText.textContent = 'Tap a suggestion to accept it.';
            aiOutput.addEventListener('click', (e) => {
                if (e.target.classList.contains('active-paragraph-mobile')) {
                    e.target.classList.add('tapped');
                    e.target.addEventListener('animationend', () => e.target.classList.remove('tapped'), { once: true });
                    acceptAISuggestion();
                }
            });
        } else {
            userInput.addEventListener('keydown', handleKeydown);
        }
    }

    function handleKeydown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            acceptAISuggestion();
        }
    }

    function acceptAISuggestion() {
        const activeSuggestionEl = aiOutput.querySelector('.active-paragraph, .active-paragraph-mobile');
        if (!activeSuggestionEl || !activeSuggestionEl.textContent.trim()) return;

        const suggestionText = activeSuggestionEl.textContent;
        const actionType = activeSuggestionEl.dataset.actionType;

        abortController.abort();
        abortController = new AbortController();
        clearTimeout(debounceTimer);

        let newFullText;
        if (actionType === 'rewrite') {
            newFullText = suggestionText;
        } else {
            newFullText = (lockedTextState ? lockedTextState + '\n\n' : '') + suggestionText;
        }

        userInput.value = newFullText + '\n\n';
        lockedTextState = newFullText.trim();
        renderLockedContent(lockedTextState);
        const currentActiveEl = aiOutput.querySelector('.active-paragraph, .active-paragraph-mobile');
        if (currentActiveEl) currentActiveEl.remove();

        userInput.focus();
        userInput.setSelectionRange(userInput.value.length, userInput.value.length);
    }

    function handleUserInput() {
        const cursorPosition = userInput.selectionStart;
        if (cursorPosition <= lockedTextState.length && userInput.value !== lockedTextState) {
            const textBeforeCursor = userInput.value.substring(0, cursorPosition);
            let paragraphStartIndex = textBeforeCursor.lastIndexOf('\n\n');
            paragraphStartIndex = (paragraphStartIndex === -1) ? 0 : paragraphStartIndex + 2;
            lockedTextState = userInput.value.substring(0, paragraphStartIndex).trim();
        }
        abortController.abort();
        abortController = new AbortController();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(triggerAI, DEBOUNCE_MS);
    }

    async function triggerAI() {
        const fullText = userInput.value;
        const activeText = fullText.substring(lockedTextState.length).trim();
        renderLockedContent(lockedTextState);

        if (!activeText && lockedTextState) {
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
        activeElement.dataset.actionType = 'append';
        activeElement.textContent = '...';

        await streamToElement({ lockedText, activeText }, activeElement);
    }

    async function handleQuickActionClick(e) {
        e.preventDefault();
        if (e.target.tagName !== 'A') return;
        quickActionsDropdown.parentElement.classList.remove('is-active');

        const action = e.target.dataset.action;
        const fullText = userInput.value;
        if (!fullText.trim()) {
            alert("There's no text to perform an action on.");
            return;
        }

        abortController.abort();
        abortController = new AbortController();
        clearTimeout(debounceTimer);

        lockedTextState = fullText.trim();
        renderLockedContent(lockedTextState);

        let activeElement = document.createElement('div');
        activeElement.className = isMobile ? 'active-paragraph-mobile' : 'active-paragraph';
        activeElement.dataset.actionType = 'rewrite';
        aiOutput.appendChild(activeElement);
        activeElement.textContent = `Rewriting to be "${action}"...`;
        
        await streamToElement({ fullText, action }, activeElement);
    }

    async function streamToElement(bodyPayload, targetElement) {
        const model = modelSwitch.checked ? 'gpt-4o' : 'gpt-4o-mini';
        currentCallData = { timestamp: new Date(), input: bodyPayload, model };

        let fullResponse = "";
        try {
            const response = await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...bodyPayload, model }),
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
                                    targetElement.textContent = fullResponse;
                                }
                            }
                        } catch (e) { /* Ignore */ }
                    }
                }
            }
            logApiCall(fullResponse);
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Streaming failed:', error);
                targetElement.textContent = "Error connecting to the assistant.";
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

    function logApiCall(response) {
        apiCallLog.unshift({ ...currentCallData, output: response });
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
            logContainer.innerHTML = '<p>No API calls made yet.</p>';
            return;
        }

        apiCallLog.forEach((call, index) => {
            const entryDiv = document.createElement('div');
            entryDiv.className = 'log-entry';
            const usageText = call.usage ? `Prompt: ${call.usage.prompt_tokens} | Completion: ${call.usage.completion_tokens}` : 'N/A';
            
            let inputContent = '';
            if (call.input.action) {
                inputContent = `---ACTION---\n${call.input.action}\n\n---FULL TEXT SENT---\n${call.input.fullText}`;
            } else {
                inputContent = `---LOCKED---\n${call.input.lockedText}\n\n---ACTIVE---\n${call.input.activeText}`;
            }
            
            entryDiv.innerHTML = `
                <div class="log-entry-header">
                    <span><strong>Call #${totalCalls - index}</strong> | ${call.timestamp.toLocaleTimeString()}</span>
                    <span><strong>Model:</strong> ${call.model} | <strong>Tokens:</strong> ${usageText}</span>
                </div>
                <div class="log-entry-body">
                    <div class="log-section-title">System Prompt Sent</div><pre>${call.systemPrompt || 'N/A'}</pre>
                    <div class="log-section-title">User Input Sent</div><pre>${inputContent}</pre>
                    <div class="log-section-title">AI Output Received</div><pre>${call.output}</pre>
                </div>`;
            logContainer.appendChild(entryDiv);
        });
    }

    function downloadLog() {
        if (apiCallLog.length === 0) return alert("No log data to download.");
        const logData = JSON.stringify(apiCallLog, null, 2);
        const blob = new Blob([logData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `kinotype-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
});