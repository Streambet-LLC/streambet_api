import { ChatType } from 'src/enums/socket.enum';

export interface ChatMessage {
  type: ChatType.User | ChatType.System;
  username: string;
  message: string;
  timestamp: Date;
  imageURL?: string;
  title?: string;
  profileUrl?: string;
  systemMessage?: string;
}
