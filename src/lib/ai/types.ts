export interface AiChatRequest {
  message: string;
}

export interface AiChatResult {
  message: string;
}

export interface AiSuccessResponse {
  success: true;
  data: AiChatResult;
}

export interface AiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type AiChatResponse = AiSuccessResponse | AiErrorResponse;

export interface AiProvider {
  generateReply(message: string): Promise<string>;
}
