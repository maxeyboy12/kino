document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENTS ---
    const userInput = document.getElementById('userInput');
    const aiOutput = document.getElementById('aiOutput');
    const logButton = document.getElementById('logButton');
    const instructionText = document.getElementById('instructionText'); // New
    const logModal = document.getElementById('logModal');
    const closeModalButton = document.querySelector('.close-button');
    const logContainer = document.getElementById('logContainer');
    const modelSwitch = document.getElementById('modelSwitch');
    const downloadLogButton = document.getElementById('downloadLogButton');

    // --- CONFIGURATION & STATE ---
    const DEBOUNCE_MS = 250;
    const WORKER_URL = 'https://lnkino-api.maxzitek8.workers.dev';
    let debounceTimer;
    let abortController = new AbortController();
    let apiCallLog = [];
    let currentCallData = {};
    let lockedTextState = "";
    // --- CHANGED: Device detection ---
    const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);


    // --- INITIALIZATION ---
    setupUIForDevice();


    // --- EVENT LISTENERS ---
    userInput.addEventListener('input', handleUserInput);
    downloadLogButton.addEventListener('click', downloadLog);
    logButton.addEventListener('click', openModal);
    closeModalButton.addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
        if (event.target == logModal) closeModal();
    });
    // --- CHANGED: Conditional event listeners based on device type ---
    function setupUIForDevice() {
        if (isMobile) {
            instructionText.textContent = 'Tap a suggestion to accept it.';
            // Use event delegation for tap-to-accept
            aiOutput.addEventListener('click', (e) => {
                if (e.target.classList.contains('active-paragraph-mobile')) {
                    e.target.classList.add('tapped');
                    // Remove animation class after it finishes
                    e.target.addEventListener('animationend', () => {
                        e.target.classList.remove('tapped');
                    }, { once: true });

                    acceptAISuggestion();
                }
            });
        } else {
            // Desktop uses keyboard shortcut
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
        const aiText = Array.from(aiOutput.children)
            .map(child => child.textContent)
            .join('\n\n');

        if (aiText.trim()) {
            abortController.abort();
            abortController = new AbortController();
            clearTimeout(debounceTimer);

            const newFullText = aiText + '\n\n';
            userInput.value = newFullText;
            lockedTextState = aiText.trim();

            userInput.focus();
            userInput.selection.start = userInput.selection.end = userInput.value.length;

            handleUserInput();
        }
    }

    function handleUserInput() {
        abortController.abort();
        abortController = new AbortController();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(triggerAI, DEBOUNCE_MS);
    }

    async function triggerAI() {
        const fullText = userInput.value;
        const lockedText = lockedTextState;
        let activeText = fullText.startsWith(lockedText)
            ? fullText.substring(lockedText.length).trim()
            : fullText.trim();

        renderLockedContent(lockedText);

        if (!activeText) {
            const activeElement = aiOutput.querySelector('.active-paragraph, .active-paragraph-mobile');
            if (activeElement) activeElement.remove();
            return;
        }

        // --- CHANGED: Selectively find or create the active element ---
        let activeElement = aiOutput.querySelector('.active-paragraph, .active-paragraph-mobile');
        if (!activeElement) {
            activeElement = document.createElement('div');
            // Apply class based on device
            activeElement.className = isMobile ? 'active-paragraph-mobile' : 'active-paragraph';
            aiOutput.appendChild(activeElement);
        }
        activeElement.textContent = '...';

        let fullResponse = "";
        const model = modelSwitch.checked ? 'gpt-4o' : 'gpt-4o-mini';
        currentCallData = { timestamp: new Date(), input: { lockedText, activeText }, model: model };

        try {
            const response = await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lockedText, activeText, model }),
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

    // --- LOGGING & MODAL FUNCTIONS (Unchanged) ---
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
                    <pre>${call.systemPrompt}</pre>
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