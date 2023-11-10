import { prompt } from "../prompts/defaultAgent";

export function initPrompt(storeName, orderCode) {
  return prompt
    .replace(/{{[\s]?storeName[\s]?}}/g, storeName)
    .replace(/{{[\s]?orderCode[\s]?}}/g, orderCode);
}
