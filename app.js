const LMSTUDIO_ENDPOINT = 'http://127.0.0.1:1234';

class ChatApp {
    constructor() {
        this.messageList = document.getElementById('messageList');
        this.chatForm = document.getElementById('chatForm');
        this.userInput = document.getElementById('userInput');
        this.modelSelect = document.getElementById('modelSelect');
        this.fileInput = document.getElementById('fileInput');
        this.documents = new Map();
        this.webpages = new Map();
        this.currentMessageId = 0;

        if (!this.modelSelect) {
            console.error('[constructor] modelSelect element not found in DOM');
        }

        this.chatForm.addEventListener('submit', (e) => this.handleSubmit(e));
        this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e.target.files));
        this.saveButton = document.getElementById('saveButton');
        this.saveButton.addEventListener('click', () => this.saveConversation());

        this.loadModels();
    }

    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    async fetchWebpage(url) {
        try {
            const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
            const data = await response.json();
            return data.contents;
        } catch (error) {
            console.error('[fetchWebpage] Error fetching webpage:', error);
            throw error;
        }
    }

    async handleSubmit(e) {
        e.preventDefault();
        const message = this.userInput.value.trim();
        if (!message) return;

        const messageId = this.currentMessageId++;
        this.addMessage(message, 'user', messageId);
        this.userInput.value = '';

        if (this.isValidUrl(message)) {
            try {
                this.addMessage('Fetching webpage content...', 'system', this.currentMessageId++);
                const content = await this.fetchWebpage(message);
                this.webpages.set(message, content);
                this.addMessage(`Webpage content fetched successfully: ${message}`, 'system', this.currentMessageId++);
            } catch (error) {
                this.addMessage(`Failed to fetch webpage: ${error.message}`, 'system', this.currentMessageId++);
            }
        }

        const model = this.modelSelect.value;
        try {
            const responseDiv = this.addMessage('', 'assistant', this.currentMessageId++);
            await this.generateLMStudioResponse(model, message, responseDiv);
        } catch (error) {
            console.error('[handleSubmit] Error:', error);
            this.addMessage('Sorry, there was an error generating the response.', 'assistant', this.currentMessageId++);
        }
    }

    addMessage(content, sender, messageId) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', `${sender}-message`);
        messageDiv.setAttribute('data-id', messageId);
        
        messageDiv.innerHTML = `<div class="message-content"></div>`;
        const contentDiv = messageDiv.querySelector('.message-content');
        
        if (content) {
            marked.setOptions({
                highlight: function(code, language) {
                    if (language && hljs.getLanguage(language)) {
                        return hljs.highlight(code, { language }).value;
                    }
                    return code;
                }
            });
            contentDiv.innerHTML = marked.parse(content);
            contentDiv.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightBlock(block);
            });
        }

        if (sender === 'system') {
            messageDiv.classList.add('system-message');
        }

        this.messageList.appendChild(messageDiv);
        this.messageList.scrollTop = this.messageList.scrollHeight;
        return messageDiv;
    }

    async handleFileUpload(files) {
        for (const file of files) {
            try {
                const content = await file.text();
                this.documents.set(file.name, content);
                this.addDocumentMessage(file.name);
            } catch (error) {
                console.error('[handleFileUpload] Error reading file:', error);
            }
        }
        this.fileInput.value = '';
    }

    addDocumentMessage(filename) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', 'system-message');
        
        messageDiv.innerHTML = `
            <div class="document-message">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                </svg>
                <span>Uploaded: ${filename}</span>
            </div>
        `;
        
        this.messageList.appendChild(messageDiv);
        this.messageList.scrollTop = this.messageList.scrollHeight;
    }

    async generateLMStudioResponse(model, prompt, messageDiv) {
        let fullPrompt = prompt;
        let context = '';

        if (this.documents.size > 0) {
            context += 'Here are the relevant documents:\n\n';
            this.documents.forEach((content, filename) => {
                context += `File: ${filename}\n${content}\n\n`;
            });
        }

        if (this.webpages.size > 0) {
            context += 'Here are the relevant webpages:\n\n';
            this.webpages.forEach((content, url) => {
                context += `URL: ${url}\nContent:\n${content}\n\n`;
            });
        }

        if (context) {
            fullPrompt = context + 'Based on this information, please respond to: ' + prompt;
        }

        const response = await fetch(`${LMSTUDIO_ENDPOINT}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'user', content: fullPrompt }
                ],
                stream: true
            })
        });

        if (!response.ok) {
            throw new Error('Failed to generate response from LM Studio');
        }

        const reader = response.body.getReader();
        const contentDiv = messageDiv.querySelector('.message-content');
        let fullResponse = '';
        let currentMarkdown = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = new TextDecoder().decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.trim() === '' || line.trim() === 'data: [DONE]') continue;
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.replace('data: ', ''));
                        if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                            fullResponse += data.choices[0].delta.content;
                            currentMarkdown = marked.parse(fullResponse);
                            contentDiv.innerHTML = currentMarkdown;
                            
                            contentDiv.querySelectorAll('pre code').forEach((block) => {
                                hljs.highlightBlock(block);
                            });
                            
                            this.messageList.scrollTop = this.messageList.scrollHeight;
                        }
                    } catch (e) {
                        console.error('[generateLMStudioResponse] Error parsing JSON:', e);
                    }
                }
            }
        }

        return fullResponse;
    }

    async loadModels() {
        const endpoint = LMSTUDIO_ENDPOINT;
        const modelEndpoint = '/v1/models';
        
        console.log(`[loadModels] Starting to load models from LM Studio at ${endpoint}${modelEndpoint}`);
        
        if (!this.modelSelect) {
            console.error('[loadModels] modelSelect element is null or undefined');
            this.addMessage('Error: Model selector not found in the page.', 'system', this.currentMessageId++);
            return;
        }

        this.modelSelect.innerHTML = '<option disabled selected>Loading models...</option>';
        
        try {
            console.log(`[loadModels] Fetching models from ${endpoint}${modelEndpoint}`);
            const response = await fetch(`${endpoint}${modelEndpoint}`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            
            console.log(`[loadModels] Response status: ${response.status}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('[loadModels] Parsed data:', JSON.stringify(data, null, 2));
            
            this.modelSelect.innerHTML = '';
            
            if (!data.data || data.data.length === 0) {
                throw new Error('No models found in LM Studio response');
            }
            console.log(`[loadModels] Found ${data.data.length} LM Studio models`);
            data.data.forEach((model, index) => {
                if (typeof model.id !== 'string' || !model.id) {
                    console.warn(`[loadModels] Skipping invalid LM Studio model ID at index ${index}`);
                    return;
                }
                console.log(`[loadModels] Adding LM Studio model ${index + 1}: ${model.id}`);
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.id;
                this.modelSelect.appendChild(option);
            });
            
            if (this.modelSelect.options.length === 0) {
                throw new Error('No valid models were added to the selector');
            }
            
            console.log(`[loadModels] Model selector updated, options count: ${this.modelSelect.options.length}`);
            console.log('[loadModels] Final modelSelect HTML:', this.modelSelect.outerHTML);
            
            // Force UI refresh
            this.modelSelect.style.display = 'none';
            this.modelSelect.offsetHeight; // Trigger reflow
            this.modelSelect.style.display = 'block';
            this.modelSelect.dispatchEvent(new Event('change'));
        } catch (error) {
            console.error('[loadModels] Error loading models:', {
                message: error.message,
                name: error.name,
                stack: error.stack,
                endpoint: `${endpoint}${modelEndpoint}`
            });
            this.modelSelect.innerHTML = `<option disabled selected>Error: ${error.message}</option>`;
            this.addMessage(`Error loading models from LM Studio: ${error.message}`, 'system', this.currentMessageId++);
        }
    }

    saveConversation() {
        let markdown = '';
        const messages = this.messageList.children;
        
        for (const message of messages) {
            const content = message.querySelector('.message-content');
            const role = message.classList.contains('user-message') ? 'User' : 
                        message.classList.contains('assistant-message') ? 'Assistant' : 'System';
            
            if (!content.textContent.trim()) continue;
            
            markdown += `## ${role}\n\n`;
            
            if (role === 'System') {
                markdown += `${content.textContent.trim()}\n\n`;
                continue;
            }
            
            const rawContent = content.innerHTML;
            const processedContent = rawContent
                .replace(/<pre><code class="language-(\w+)">/g, '```$1\n')
                .replace(/<\/code><\/pre>/g, '\n```\n')
                .replace(/<code>/g, '`')
                .replace(/<\/code>/g, '`')
                .replace(/<[^>]+>/g, '');
            
            markdown += `${processedContent}\n\n`;
        }

        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = `conversation-${timestamp}.md`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[DOMContentLoaded] Initializing ChatApp');
    new ChatApp();
});