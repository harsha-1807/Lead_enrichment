// This module defines a function to fetch chat suggestions based on chat history.
// It handles model and provider configurations (including custom OpenAI settings) from localStorage
// and sends a POST request to the /api/suggestions endpoint.
import { Message } from '@/components/ChatWindow';

/**
 * Fetches chat suggestions from the backend API based on the provided chat history.
 * It includes the currently selected chat model and provider,
 * and optionally includes custom OpenAI configuration if set in localStorage.
 *
 * @param chatHisory - An array of Message objects representing the conversation history.
 * @returns An array of suggestion strings from the API.
 */
export const getSuggestions = async (chatHisory: Message[]) => {
  // Get the selected model and provider from localStorage
  const chatModel = localStorage.getItem('chatModel');
  // Get the selected model and provider from localStorage
  const chatModelProvider = localStorage.getItem('chatModelProvider');

  // Get custom OpenAI configuration if applicable
  const customOpenAIKey = localStorage.getItem('openAIApiKey');
  // Get custom OpenAI configuration if applicable
  const customOpenAIBaseURL = localStorage.getItem('openAIBaseURL');

  // Send a POST request to the backend API with the chat history and model configuration
  const res = await fetch(`/api/suggestions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chatHistory: chatHisory,
      chatModel: {
        provider: chatModelProvider,
        model: chatModel,
        ...(chatModelProvider === 'custom_openai' && {
          customOpenAIKey,
          customOpenAIBaseURL,
        }),
      },
    }),
  });

  const data = (await res.json()) as { suggestions: string[] };

  // Return the list of suggestions extracted from the API response
  return data.suggestions;
};
