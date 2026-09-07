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

import React, { useState } from "react";
import '@livekit/components-styles';
import './livekit-overrides.css';
import { LiveKitRoom, VideoConference, useParticipants } from "@livekit/components-react";
import dynamic from "next/dynamic";
import LivekitToolbarFix from './LivekitToolbarFix';

const LiveKitChat = dynamic(() => import("@/components/LiveKitChat"), { ssr: false });

export default function TeacherPage() {
  const mockTeachers = [
    { name: "Mrs. Johnson", room: "Math101" },
    { name: "Mr. Smith", room: "Physics201" },
    { name: "Ms. Lee", room: "Chemistry301" },
  ];
  const [name, setName] = useState(mockTeachers[0].name);
  const [room, setRoom] = useState(mockTeachers[0].room);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/livekit-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: name, name, room, isTeacher: true }),
      });
      const data = await res.json();
      if (data.token) setToken(data.token);
      else setError(data.error || "Failed to get token");
    } catch (err) {
      setError("Network error");
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
  <div className="w-full max-w-5xl bg-card dark:bg-card rounded-3xl shadow-lg p-8 md:p-12 flex flex-col items-stretch border border-gray-200 dark:border-gray-700 bg-dark-2 ">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-50 mb-2">Teacher Live Class</h1>
          <p className="text-base text-gray-600 dark:text-gray-300">Start and manage your virtual classroom session</p>
        </div>
        {!token ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6 w-full max-w-lg mx-auto">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">Select Teacher:</label>
            <select
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              value={name + "|" + room}
              onChange={e => {
                const [n, r] = e.target.value.split("|");
                setName(n);
                setRoom(r);
              }}
            >
              {mockTeachers.map(t => (
                <option key={t.name} value={t.name + "|" + t.room}>{t.name} ({t.room})</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">Your Name:</label>
            <input
              type="text"
              placeholder="Enter your name"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900 dark:text-gray-100">Class/Room Name:</label>
            <input
              type="text"
              placeholder="e.g., Math101"
              value={room}
              onChange={e => setRoom(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              required
            />
          </div>
          <button 
            type="submit" 
            className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold px-6 py-3 rounded-lg hover:from-blue-700 hover:to-blue-800 transition shadow-md mt-4"
          >
            Start Class
          </button>
          {error && <p className="text-red-500 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">{error}</p>}
        </form>
      ) : (
        <div className="w-full livekit-wrapper rounded-lg overflow-hidden">
          <LivekitToolbarFix />
          <LiveKitRoom
            token={token}
            serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
            connect={true}
            data-lk-theme="default"
          >
            <VideoConference />
            <ViewerList />
            <LiveKitChat name={name} />
          </LiveKitRoom>
        </div>
      )}
      </div>
    </main>
  );

// Custom component to show list of students watching
function ViewerList() {
  const participants = useParticipants();
  // Filter out the teacher (local participant)
  const viewers = Array.from(participants.values()).filter(p => !p.isLocal);
  return (
    <div className="w-full border border-gray-200 dark:border-gray-700 rounded-lg p-6 mt-6 bg-gray-50 dark:bg-gray-800/50">
      <h2 className="font-bold text-lg text-gray-900 dark:text-gray-50 mb-4">Students Watching ({viewers.length})</h2>
      <ul className="space-y-2">
        {viewers.length === 0 && <li className="text-gray-600 dark:text-gray-400">No students watching yet.</li>}
        {viewers.map((p) => (
          <li key={p.identity} className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            {p.name || p.identity}
          </li>
        ))}
      </ul>
    </div>
  );
}
}

