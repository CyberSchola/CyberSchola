/*
  * @license GPL-3.0
  * Copyright (C) <2007>  [ Patrick Nnodu ]

   This program is free software: you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation, either version 3 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.
*/

"use client";
import React, { useState, useRef, useEffect } from "react";
import { useDataChannel, useLocalParticipant, useParticipants } from "@livekit/components-react";
import '@livekit/components-styles';

interface ChatMessage {
  sender: string;
  text: string;
}

export default function LiveKitChat({ name }: { name: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const { send, message } = useDataChannel();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!message) return;
    try {
      const msg = JSON.parse(new TextDecoder().decode(message.payload));
      setMessages((prev) => [...prev, msg]);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim()) return;
    const msg: ChatMessage = { sender: name, text: input };
    send(new TextEncoder().encode(JSON.stringify(msg)), { reliable: true });
    setMessages((prev) => [...prev, msg]);
    setInput("");
  };

  return (
    <div className="w-full border rounded p-4 mt-4 flex flex-col bg-black " style={{ height: 300 }}>
      <h2 className="font-semibold mb-2">Alt. Live Chat</h2>
      <div className="flex-1 overflow-y-auto mb-2">
        {messages.map((msg, idx) => (
          <div key={idx} className={msg.sender === name ? "text-right" : "text-left"}>
            <span className="font-bold">{msg.sender}:</span> {msg.text}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          className="border p-2 rounded flex-1"
          placeholder="Type your question or comment..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') sendMessage(); }}
        />
        <button onClick={sendMessage} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Send</button>
      </div>
    </div>
  );
}
