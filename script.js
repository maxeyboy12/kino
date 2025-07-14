document.addEventListener('DOMContentLoaded', () => {
    // --- DOM ELEMENTS ---
    const userInput = document.getElementById('userInput');
    const aiOutput = document.getElementById('aiOutput');
    const logButton = document.getElementById('logButton');
    const logModal = document.getElementById('logModal');
    const closeModalButton = document.querySelector('.close-button');
    const logContainer = document.getElementById('logContainer');
    // CHANGED: New elements for model toggle and log download
    const modelSwitch = document.getElementById('modelSwitch');
    const downloadLogButton = document.getElementById('downloadLogButton');


    // --- CONFIGURATION & STATE ---
    const DEBOUNCE_MS = 250;
    const WORKER_URL = 'https://lnkino-api.maxzitek8.workers.dev';
    let debounceTimer;
    let abortController = new AbortController();
    let apiCallLog = [];
    // CHANGED: To hold data between stream completion and logging
    let currentCallData = {};

    // --- EVENT LISTENERS ---
    userInput.addEventListener('input', handleUserInput);
    // CHANGED: New listener for the 'accept' keystroke
    userInput.addEventListener('keydown', handleKeydown);
    logButton.addEventListener('click', openModal);
    closeModalButton.addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
        if (event.target == logModal) closeModal();
    });
    // CHANGED: Listener for the download button
    downloadLogButton.addEventListener('click', downloadLog);


    // --- CORE FUNCTIONS ---

    // CHANGED: New handler for keydown events, specifically for Ctrl+Enter
    function handleKeydown(e) {
        // Check for Ctrl+Enter or Cmd+Enter
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault(); // Prevent default action (e.g., new line)
            acceptAISuggestion();
        }
    }

    // CHANGED: New function to implement the "accept" logic
    function acceptAISuggestion() {
        // Reconstruct the full text from the AI pane
        const aiText = Array.from(aiOutput.children)
            .map(child => child.textContent)
            .join('\n\n');

        if (aiText.trim()) {
            // Abort any pending requests
            abortController.abort();
            abortController = new AbortController();
            clearTimeout(debounceTimer);

            // Update the user input with the AI's version
            userInput.value = aiText + '\n\n';

            // Move cursor to the end
            userInput.focus();
            userInput.selection.start = userInput.selection.end = userInput.value.length;

            // Immediately trigger AI to update the view
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
        // CHANGED: The logic for splitting text is now simpler.
        // Everything before the final double newline is locked.
        const lastParagraphIndex = fullText.lastIndexOf('\n\n');

        let lockedText = "";
        let activeText = fullText;

        if (lastParagraphIndex !== -1) {
            lockedText = fullText.substring(0, lastParagraphIndex).trim();
            activeText = fullText.substring(lastParagraphIndex).trim();
        }

        renderLockedContent(lockedText); // Always render locked part first

        if (!activeText.trim()) {
            // If no active text, clear the active part of the AI display
            const activeElement = aiOutput.querySelector('.active-paragraph');
            if (activeElement) activeElement.remove();
            return;
        }

        // Get or create the element for the active AI suggestion
        let activeElement = aiOutput.querySelector('.active-paragraph');
        if (!activeElement) {
            activeElement = document.createElement('div');
            activeElement.className = 'active-paragraph';
            aiOutput.appendChild(activeElement);
        }
        activeElement.textContent = '...'; // Show loading indicator

        let fullResponse = "";
        // CHANGED: Get selected model from the toggle
        const model = modelSwitch.checked ? 'gpt-4o' : 'gpt-4o-mini';

        // CHANGED: Prepare data for logging
        currentCallData = {
            timestamp: new Date(),
            input: { lockedText, activeText },
            model: model,
        };

        try {
            const response = await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lockedText, activeText, model }),
                signal: abortController.signal,
            });

            if (!response.ok) throw new Error(`Worker error: ${response.statusText}`);
            if (!response.body) throw new Error("Response body is missing.");

            // CHANGED: Get system prompt from response headers for logging
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
                            // CHANGED: Check for usage stats in the final chunk
                            if (json.usage) {
                                currentCallData.usage = json.usage;
                            } else {
                                const token = json.choices[0]?.delta?.content || "";
                                if (token) {
                                    fullResponse += token;
                                    activeElement.textContent = fullResponse;
                                }
                            }
                        } catch (e) {
                            // Ignore JSON parsing errors for partial chunks
                        }
                    }
                }
            }

            // CHANGED: Log the complete call details after the stream finishes
            logApiCall(fullResponse);

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Fetch aborted.');
                // Don't show error message, just stop.
            } else {
                console.error('Error calling AI:', error);
                activeElement.textContent = "Error connecting to the assistant.";
            }
        }
    }

    function renderLockedContent(lockedContent) {
        aiOutput.innerHTML = ''; // Clear everything
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


    // --- LOGGING & MODAL FUNCTIONS ---

    // CHANGED: Logging function now uses the temporarily stored call data
    function logApiCall(response) {
        const callData = {
            ...currentCallData,
            output: response,
        };
        apiCallLog.unshift(callData);
        currentCallData = {}; // Clear for next call
    }

    function openModal() {
        renderLog();
        logModal.style.display = 'block';
    }

    function closeModal() {
        logModal.style.display = 'none';
    }

    // CHANGED: Log rendering is completely overhauled for the new data structure
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

            const usageText = call.usage
                ? `Prompt: ${call.usage.prompt_tokens} | Completion: ${call.usage.completion_tokens} | Total: ${call.usage.total_tokens}`
                : 'N/A';

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
                </div>
            `;
            logContainer.appendChild(entryDiv);
        });
    }

    // CHANGED: New function to handle downloading the log
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