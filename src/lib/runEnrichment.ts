const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY!);

function toErrorString(err: any): string {
  if (!err) return 'Unknown error';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Types
export interface Message {
  messageId: string;
  chatId: string;
  createdAt: Date;
  content: string;
  role: 'user' | 'assistant';
  suggestions?: string[];
  sources?: any[];
}

export interface ChatModelProvider {
  name: string;
  provider: string;
}

export interface EmbeddingModelProvider {
  name: string;
  provider: string;
}

export interface EnrichmentResult {
  question: string;
  answer: string;
}

export interface LeadEnrichmentParams {
  emails: string[];
  chatModelProvider?: ChatModelProvider;
  embeddingModelProvider?: EmbeddingModelProvider;
  focusMode?: string;
  optimizationMode?: string;
  systemInstructions?: string;
}

export interface LeadEnrichmentResponse {
  success: boolean;
  results: {
    email: string;
    company: string;
    chatId: string;
    enrichmentData: EnrichmentResult[];
    error?: string;
    score?: number;
    reason?: string;
  }[];
  errors: string[];
}

async function scoreLeadWithGemini(lead: {
  email: string;
  domain: string;
  createdAt: string;
  results: EnrichmentResult[];
}): Promise<{ reason: string; score: number }> {
  const formattedResults = lead.results
    .map((r) => `Q: ${r.question}\nA: ${r.answer}`)
    .join('\n');
  const prompt = `
  You are a lead scoring assistant.

  Given the company's data below, assign a numeric score for each of the following criteria. Use this scoring logic:

  🔸 Revenue Score (out of 20)
    • > ₹80Cr or $10M → 20 pts
    • ₹8Cr–₹80Cr or $1M–$10M → 15 pts
    • ₹80L–₹8Cr or $100k–$1M → 10 pts
    • < ₹80L or < $100k → 5 pts
    • No data → 0 pts

  🔸 Employee Size (out of 10)
    • > 200 → 10 pts
    • 51–200 → 7 pts
    • 11–50 → 5 pts
    • ≤ 10 → 2 pts
    • No data → 0 pts

  🔸 Years in Business (out of 10)
    • > 10 years → 10 pts
    • 5–10 years → 7 pts
    • < 5 years → 4 pts
    • No data → 0 pts

  🔸 Funding Score (out of 15)
    • > $5M or ₹40Cr → 15 pts
    • < $5M or ₹40Cr → 10 pts
    • No funding → 0 pts

  🔸 Fortune 500 Presence (out of 10)
    • In list → 10 pts
    • Not in list → 0 pts

  🔸 Fortune 100 Presence (out of 10)
    • In list → 10 pts
    • Not in list → 0 pts

  🔸 Clients / Logos / Big Accounts (out of 15)
    • Enterprise Clients or Well-known Brands → 15 pts
    • Multiple Mid-size Clients → 10 pts
    • Mostly Small Businesses → 5 pts
    • No data → 0 pts

  Add the individual scores and return a total score out of 90.
  Then explain briefly why you gave this score.

  Output ONLY in this format:

  Revenue Score: <x>/20
  Employee Size Score: <x>/10
  Years in Business Score: <x>/10
  Funding Score: <x>/15
  Fortune 500 Score: <x>/10
  Fortune 100 Score: <x>/10
  Clients Score: <x>/15
  Total Score: <x>/90
  Reason: <short explanation>

  Company Data:
  ${formattedResults}
  `;

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const chat = model.startChat();
  const result = await chat.sendMessage(prompt);
  const text = result.response.text();

  let reason = 'N/A',
    score = 0;
  try {
    const scoreMatch = text.match(/Total Score:\s*(\d+(\.\d+)?)/);
    const fullReason = text.match(
      /Revenue Score:.*(?:\n.*?)+Reason:\s*([\s\S]*)/,
    );
    score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
    reason = fullReason ? text.trim() : 'N/A';
  } catch (err) {
    reason = 'Parse failed';
    score = 0;
  }

  return { reason, score };
}

// Extracting lead fields using LLM
async function extractCrmLeadFieldsWithLLM(
  company: string,
  enrichmentData: EnrichmentResult[],
  chatModelProvider: ChatModelProvider,
  embeddingModelProvider: EmbeddingModelProvider,
  focusMode: string,
  optimizationMode: string,
  systemInstructions?: string,
  chatId?: string,
): Promise<Record<string, any>> {

    const formattedResults = enrichmentData
    .map(({ question, answer }) => `Q: ${question}\nA: ${answer}`)
    .join('\n');


  const prompt = `
Extract the following details for ${company} as structured JSON if possible.
Return only:
{
  "Customer Type": ...,
  "Contact Search": ...,
  "Phone": ...,
  "Mobile": ...,
  "Description": ...,
  "Street": ...,
  "City": ...,
  "State": ...,
  "Zip Code": ...,
  "Country": ...,
}
Return ONLY the JSON. Fill fields with data or null if not found.
Use the following company data context to answer the best you can:
${formattedResults}
  `;

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const chat = model.startChat();
  const result = await chat.sendMessage(prompt);
  const text = result.response.text();

  // Try to parse JSON from LLM output
  try {
    const firstJson = text.match(/\{[\s\S]*?\}/);
    if (firstJson) {
      return JSON.parse(firstJson[0]);
    }
    return {};
  } catch (err) {
    console.error('Error parsing CRM JSON from LLM:', err, text);
    return {};
  }
}

// Default configuration - these will be overridden by actual available models
const DEFAULT_CONFIG = {
  focusMode: 'webSearch',
  optimizationMode: 'speed',
};

/**
 * Fetches available model providers from the API
 */
async function fetchModelProviders(): Promise<any> {
  const response = await fetch(`${BASE_URL}/api/models`, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch models: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

/**
 * Validates and configures model providers
 */
async function configureModelProviders(
  chatModelProvider?: ChatModelProvider,
  embeddingModelProvider?: EmbeddingModelProvider,
): Promise<{
  chatModel: ChatModelProvider;
  embeddingModel: EmbeddingModelProvider;
}> {
  try {
    const providers = await fetchModelProviders();

    // Configure chat model - use exact same logic as original TSX
    let finalChatModel: ChatModelProvider;

    if (chatModelProvider) {
      // If provided, validate it exists
      if (
        providers.chatModelProviders[chatModelProvider.provider] &&
        providers.chatModelProviders[chatModelProvider.provider][
          chatModelProvider.name
        ]
      ) {
        finalChatModel = chatModelProvider;
      } else {
        // Fallback if provided model doesn't exist
        const chatModelProvidersKeys = Object.keys(
          providers.chatModelProviders,
        );
        const availableProvider =
          chatModelProvidersKeys.find(
            (provider) =>
              Object.keys(providers.chatModelProviders[provider]).length > 0,
          ) || chatModelProvidersKeys[0];

        finalChatModel = {
          provider: availableProvider,
          name: Object.keys(providers.chatModelProviders[availableProvider])[0],
        };
      }
    } else {
      // No provider specified, use first available (same as TSX logic)
      const chatModelProvidersKeys = Object.keys(providers.chatModelProviders);

      if (
        !providers.chatModelProviders ||
        chatModelProvidersKeys.length === 0
      ) {
        throw new Error('No chat models available');
      }

      const availableProvider =
        chatModelProvidersKeys.find(
          (provider) =>
            Object.keys(providers.chatModelProviders[provider]).length > 0,
        ) || chatModelProvidersKeys[0];

      if (
        availableProvider === 'custom_openai' &&
        Object.keys(providers.chatModelProviders[availableProvider]).length ===
          0
      ) {
        throw new Error(
          'No chat model providers configured. Please configure them from the settings page or config file.',
        );
      }

      finalChatModel = {
        provider: availableProvider,
        name: Object.keys(providers.chatModelProviders[availableProvider])[0],
      };
    }

    // Configure embedding model - use exact same logic as original TSX
    let finalEmbeddingModel: EmbeddingModelProvider;

    if (embeddingModelProvider) {
      // If provided, validate it exists
      if (
        providers.embeddingModelProviders[embeddingModelProvider.provider] &&
        providers.embeddingModelProviders[embeddingModelProvider.provider][
          embeddingModelProvider.name
        ]
      ) {
        finalEmbeddingModel = embeddingModelProvider;
      } else {
        // Fallback if provided model doesn't exist
        const embeddingProviderKeys = Object.keys(
          providers.embeddingModelProviders,
        );
        const availableProvider = embeddingProviderKeys[0];

        finalEmbeddingModel = {
          provider: availableProvider,
          name: Object.keys(
            providers.embeddingModelProviders[availableProvider],
          )[0],
        };
      }
    } else {
      // No provider specified, use first available (same as TSX logic)
      const embeddingModelProviders = providers.embeddingModelProviders;

      if (
        !embeddingModelProviders ||
        Object.keys(embeddingModelProviders).length === 0
      ) {
        throw new Error('No embedding models available');
      }

      const embeddingModelProvider = Object.keys(embeddingModelProviders)[0];

      finalEmbeddingModel = {
        provider: embeddingModelProvider,
        name: Object.keys(embeddingModelProviders[embeddingModelProvider])[0],
      };
    }

    return {
      chatModel: finalChatModel,
      embeddingModel: finalEmbeddingModel,
    };
  } catch (error) {
    console.error('Error configuring model providers:', error);
    throw error; // Re-throw to handle in calling function
  }
}

/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage(
  message: string,
  chatId: string,
  chatModelProvider: ChatModelProvider,
  embeddingModelProvider: EmbeddingModelProvider,
  focusMode: string = 'webSearch',
  optimizationMode: string = 'speed',
  systemInstructions?: string,
  chatHistory: [string, string][] = [],
): Promise<string> {
  const messageId = crypto.randomBytes(7).toString('hex');

  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: message,
      message: {
        messageId: messageId,
        chatId: chatId,
        content: message,
      },
      chatId: chatId,
      files: [],
      focusMode: focusMode,
      optimizationMode: optimizationMode,
      history: chatHistory,
      chatModel: {
        name: chatModelProvider.name,
        provider: chatModelProvider.provider,
      },
      embeddingModel: {
        name: embeddingModelProvider.name,
        provider: embeddingModelProvider.provider,
      },
      systemInstructions: systemInstructions,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const tail = text ? ` | body: ${text.slice(0, 200)}` : '';
    throw new Error(
      `Chat API ${response.status} ${response.statusText}${tail}`,
    );
  }

  if (!response.body) {
    throw new Error('No response body received from chat API');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let partialChunk = '';
  let receivedMessage = '';

  // Process streaming response
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    partialChunk += decoder.decode(value, { stream: true });

    try {
      const messages = partialChunk.split('\n');
      for (const msg of messages) {
        if (!msg.trim()) continue;

        const data = JSON.parse(msg);

        if (data.type === 'error') {
          throw new Error(data.data);
        }

        if (data.type === 'message') {
          receivedMessage += data.data;
        }

        if (data.type === 'messageEnd') {
          return receivedMessage.trim();
        }
      }
      partialChunk = '';
    } catch (error) {
      // Incomplete JSON, continue reading
      continue;
    }
  }

  return receivedMessage.trim();
}

/**
 * Generates enrichment questions for a company
 */
function generateEnrichmentQuestions(
  company: string,
  fullDomain: string,
): string[] {
  return [
    `What does ${company} company do? Please give a short description in two lines.`,
    `What is the website of the company with the domain ${fullDomain}?`,
    `What are the revenue figures for the company with the domain ${fullDomain}? Only include results related to this entity and list each figure along with the source name.`,
    `What is the employee size of ${company} company? Please reply with only the number of employees in two short sentences, without additional explanation.`,
    `How many years has ${company} company been in business? Please reply with only the number of years in two short sentences, without additional explanation.`,
    `What is the latest funding news for ${company} company? Please reply with only the latest funding amount and date in two short sentences in bullet points, without additional explanation.`,
    `Is ${company} in the Fortune 500 list? Please respond with a yes or no and one short supporting detail.`,
    `Is ${company} in the Fortune 100 list? Please respond with a yes or no and one short supporting detail.`,
    `Who are the clients of ${company}? List major clients or industries they serve.`,
    `What is the industry classification of ${company}?`,
    `What is the LinkedIn profile link of the company named ${company}? Return only the link.`,
  ];
}

/**
 * Processes lead enrichment for a single email
 */
async function processLeadEnrichment(
  email: string,
  chatModelProvider: ChatModelProvider,
  embeddingModelProvider: EmbeddingModelProvider,
  focusMode: string,
  optimizationMode: string,
  systemInstructions?: string,
  structuredFields: Record<string, any> = {},
): Promise<{
  email: string;
  company: string;
  chatId: string;
  enrichmentData: EnrichmentResult[];
  error?: string;
  score?: number;
  reason?: string;
  structuredFields?: Record<string, any>;
}> {
  try {
    // Helper to extract company/domain info from email
    const extractCompanyInfo = (email: string) => {
      const domain = email.split('@')[1];
      const companyName = domain.split('.')[0];

      return {
        companyName,
        fullDomain: domain,
        searchQuery: `"${companyName}" site:${domain} OR "${companyName}" company`,
        fallbackQuery: `"${companyName}.${domain.split('.').pop()}" company information`,
      };
    };

    // Extract company from email domain
    const { companyName, fullDomain } = extractCompanyInfo(email);
    const company = companyName;
    const domain = fullDomain;

    // Generate new chat ID for this enrichment session
    const chatId = crypto.randomBytes(20).toString('hex');

    // Generate enrichment questions
    const enrichmentQuestions = generateEnrichmentQuestions(company, domain);

    // Process each question
    const enrichmentResults: EnrichmentResult[] = [];
    const chatHistory: [string, string][] = [];

    for (const question of enrichmentQuestions) {
      try {
        const answer = await sendMessage(
          question,
          chatId,
          chatModelProvider,
          embeddingModelProvider,
          focusMode,
          optimizationMode,
          systemInstructions,
          chatHistory,
        );

        enrichmentResults.push({ question, answer });

        // Update chat history
        chatHistory.push(['human', question]);
        chatHistory.push(['assistant', answer]);

        // Add delay between requests to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Error processing question for ${company}:`, error);
        enrichmentResults.push({
          question,
          answer: `Error: ${toErrorString(error)}`,
        });
      }
    }
    // Scoring with gemini 
    const { score, reason } = await scoreLeadWithGemini({
      email,
      domain,
      createdAt: new Date().toISOString(),
      results: enrichmentResults,
    });
    // extracting structured fields with LLM
    const extractedStructuredFields = await extractCrmLeadFieldsWithLLM(
      company,
      enrichmentResults,
      chatModelProvider,
      embeddingModelProvider,
      focusMode,
      optimizationMode,
      systemInstructions,
      chatId
    );
    // Skipping DB save: return results directly in API response
    return {
      email,
      company,
      chatId,
      enrichmentData: enrichmentResults,
      score,
      reason,
      structuredFields: extractedStructuredFields,
    };
  } catch (error) {
    console.error(`Error processing lead enrichment for ${email}:`, error);
    return {
      email,
      company: email.split('@')[1]?.split('.')[0] || 'unknown',
      chatId: '',
      enrichmentData: [],
      error: toErrorString(error),
      structuredFields: {}
    };
  }
}


/**
 * Main function to enrich multiple leads
 */
export async function enrichLeads(
  params: LeadEnrichmentParams,
): Promise<LeadEnrichmentResponse> {
  const {
    emails,
    chatModelProvider,
    embeddingModelProvider,
    focusMode = DEFAULT_CONFIG.focusMode,
    optimizationMode = DEFAULT_CONFIG.optimizationMode,
    systemInstructions,
  } = params;

  // Validate and filter emails
  const validEmails = emails
    .map((email) => email.trim())
    .filter((email) => email.includes('@') && email.length > 0);

  if (validEmails.length === 0) {
    return {
      success: false,
      results: [],
      errors: ['No valid email addresses provided'],
    };
  }

  const results = [];
  const errors = [];

  try {
    // Configure model providers
    const { chatModel, embeddingModel } = await configureModelProviders(
      chatModelProvider,
      embeddingModelProvider,
    );

    // Process each email
    for (const email of validEmails) {
      try {
        console.log(`Processing lead enrichment for: ${email}`);

        const result = await processLeadEnrichment(
          email,
          chatModel,
          embeddingModel,
          focusMode,
          optimizationMode,
          systemInstructions,
        );

        results.push(result);
        if (result.error) {
          errors.push(`Failed ${email}: ${result.error}`);
        }

        // Add delay between emails to avoid overwhelming the system
        if (validEmails.indexOf(email) < validEmails.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } catch (error) {
        const errorMessage = `Failed to process ${email}: ${toErrorString(error)}`;
        console.error(errorMessage);
        errors.push(errorMessage);
      }
    }

    return {
      success: errors.length === 0,
      results,
      errors,
    };
  } catch (error) {
    const errorMessage = `Configuration error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.error(errorMessage);

    return {
      success: false,
      results,
      errors: [errorMessage, ...errors],
    };
  }
}

/**
 * Convenience function for single email enrichment
 */
export async function enrichSingleLead(
  email: string,
  options?: Omit<LeadEnrichmentParams, 'emails'>,
): Promise<LeadEnrichmentResponse> {
  return enrichLeads({
    emails: [email],
    ...options,
  });
}