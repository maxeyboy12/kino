document.addEventListener('DOMContentLoaded', () => {
    const userInput = document.getElementById('userInput');
    const aiOutput = document.getElementById('aiOutput');
    const logButton = document.getElementById('logButton');
    const instructionText = document.getElementById('instructionText');
    const logModal = document.getElementById('logModal');
    const closeModalButton = document.querySelector('.close-button');
    const logContainer = document.getElementById('logContainer');
    const downloadLogButton = document.getElementById('downloadLogButton');
    const quickActionsDropdown = document.getElementById('quickActionsDropdown');
    const copyButton = document.getElementById('copyAiOutput');

    const DEBOUNCE_MS = 150;
    const WORKER_URL = 'https://lnkino-api.maxzitek8.workers.dev';
    let debounceTimer;
    let abortController = new AbortController();
    let apiCallLog = [];
    let currentCallData = {};
    let lockedTextState = ""; // Single source of truth for all "locked" content
    const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

    setupUIForDevice();

    userInput.addEventListener('input', handleUserInput);
    downloadLogButton.addEventListener('click', downloadLog);
    logButton.addEventListener('click', openModal);
    closeModalButton.addEventListener('click', closeModal);
    quickActionsDropdown.addEventListener('click', handleQuickActionClick);
    copyButton.addEventListener('click', () => {
        const outputText = aiOutput.innerText;
        navigator.clipboard.writeText(outputText).then(() => {
            showCopiedTooltip();
        });
    });

    window.addEventListener('click', (event) => {
        if (event.target == logModal) closeModal();
    });

    function setupUIForDevice() {
        if (isMobile) {
            instructionText.textContent = 'Tap a suggestion to lock it in.';
            aiOutput.addEventListener('click', (e) => {
                const target = e.target.closest('.active-paragraph-mobile');
                if (target) {
                    target.classList.add('tapped');
                    target.addEventListener('animationend', () => target.classList.remove('tapped'), { once: true });
                    lockInSuggestion(target);
                }
            });
        } else {
            instructionText.innerHTML = 'Write, then press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to lock in.';
            userInput.addEventListener('keydown', handleKeydown);
        }
    }

    function handleKeydown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            lockInCurrentText();
        }
    }

    function lockInCurrentText() {
        const suggestionElement = aiOutput.querySelector('.active-paragraph');
        if (!suggestionElement || !suggestionElement.textContent.trim() || suggestionElement.textContent.trim() === '...') {
            console.log("Lock-in aborted: No valid suggestion found.");
            return;
        }

        const suggestionText = suggestionElement.textContent.trim();
        abortController.abort();
        clearTimeout(debounceTimer);
        lockedTextState = (lockedTextState ? lockedTextState + '\n\n' : '') + suggestionText;
        userInput.value = lockedTextState + '\n\n';
        renderLockedContent(lockedTextState);
        userInput.focus();
        userInput.setSelectionRange(userInput.value.length, userInput.value.length);
    }

    function lockInSuggestion(suggestionElement) {
        if (!suggestionElement || !suggestionElement.textContent.trim()) return;

        const suggestionText = suggestionElement.textContent;
        abortController.abort();
        clearTimeout(debounceTimer);
        lockedTextState = (lockedTextState ? lockedTextState + '\n\n' : '') + suggestionText;
        userInput.value = lockedTextState + '\n\n';
        renderLockedContent(lockedTextState);
        suggestionElement.remove();
        userInput.focus();
        userInput.setSelectionRange(userInput.value.length, userInput.value.length);
    }

    function handleUserInput() {
        abortController.abort();
        abortController = new AbortController();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(triggerAI, DEBOUNCE_MS);
    }

    async function triggerAI() {
        // The active text is whatever follows the officially locked text
        const activeText = userInput.value.substring(lockedTextState.length).trimStart();
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

        const bodyPayload = { lockedText: lockedTextState, activeText: activeText };
        await streamToElement(bodyPayload, activeElement);
    }

    async function handleQuickActionClick(e) {
        e.preventDefault();
        if (e.target.tagName !== 'A') return;

        if (isMobile) {
            e.target.closest('.dropdown').blur();
        }

        const action = e.target.dataset.action;
        const fullText = userInput.value.trim();
        if (!fullText) {
            alert("There's no text to perform an action on.");
            return;
        }

        abortController.abort();
        abortController = new AbortController();
        clearTimeout(debounceTimer);
        renderLockedContent("");

        let activeElement = document.createElement('div');
        activeElement.className = isMobile ? 'active-paragraph-mobile' : 'active-paragraph';
        aiOutput.appendChild(activeElement);
        activeElement.textContent = `Rewriting to be "${action}"...`;

        const bodyPayload = { fullText, action };
        await streamToElement(bodyPayload, activeElement);
    }

    async function streamToElement(bodyPayload, targetElement) {
        const model = 'gpt-4o'; // Always use gpt-4o
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

            targetElement.textContent = ""; // Clear "..." before streaming
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
                        } catch (e) { console.error("Error parsing stream data:", e); }
                    }
                }
            }
            logApiCall(fullResponse);
            return fullResponse;
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Streaming failed:', error);
                targetElement.textContent = "Error connecting to the assistant.";
            }
            return null;
        }
    }

    function renderLockedContent(lockedContent) {
        aiOutput.innerHTML = '';
        if (!lockedContent) return;

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
                inputContent = `---LOCKED---\n${call.input.lockedText || "N/A"}\n\n---ACTIVE---\n${call.input.activeText}`;
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

    function showCopiedTooltip() {
        const tooltip = document.createElement('div');
        tooltip.className = 'copy-tooltip';
        tooltip.textContent = 'Copied!';
        document.body.appendChild(tooltip);

        const rect = copyButton.getBoundingClientRect();
        tooltip.style.position = 'absolute';
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.top = `${rect.top - 30}px`;
        tooltip.style.transform = 'translateX(-50%)';
        tooltip.style.padding = '5px 10px';
        tooltip.style.background = '#333';
        tooltip.style.color = '#fff';
        tooltip.style.borderRadius = '4px';
        tooltip.style.fontSize = '12px';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.opacity = '1';

        setTimeout(() => {
            tooltip.style.transition = 'opacity 0.3s ease';
            tooltip.style.opacity = '0';
            tooltip.addEventListener('transitionend', () => {
                tooltip.remove();
            });
        }, 1200);
    }
});