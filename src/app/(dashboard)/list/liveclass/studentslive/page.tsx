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
import Script from "next/script";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import dynamic from "next/dynamic";

const LiveKitChat = dynamic(() => import("@/components/LiveKitChat"), { ssr: false });

const PAYSTACK_PUBLIC_KEY = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || "";

export default function StudentPage() {
  const mockStudents = [
    { name: "Alice", room: "Math101", email: "alice@example.com" },
    { name: "Bob", room: "Physics201", email: "bob@example.com" },
    { name: "Charlie", room: "Chemistry301", email: "charlie@example.com" },
  ];
  const [name, setName] = useState(mockStudents[0].name);
  const [room, setRoom] = useState(mockStudents[0].room);
  const [email, setEmail] = useState(mockStudents[0].email);
  const [token, setToken] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/livekit-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: name, name, room, isTeacher: false }),
      });
      const data = await res.json();
      if (data.token) setToken(data.token);
      else setError(data.error || "Failed to get token");
    } catch (err) {
      setError("Network error");
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <Script src="https://js.paystack.co/v1/inline.js" strategy="beforeInteractive" />
      <h1 className="text-2xl font-bold mb-4">Student Live Class</h1>
      {!paid ? (
        <form onSubmit={e => { e.preventDefault(); handlePaystack(); }} className="flex flex-col gap-4 w-full max-w-sm">
          <label className="font-semibold">Select Mock Student:</label>
          <select
            className="p-2 w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            value={name + "|" + room + "|" + email}
            onChange={e => {
              const [n, r, em] = e.target.value.split("|");
              setName(n);
              setRoom(r);
              setEmail(em);
            }}
          >
            {mockStudents.map(s => (
              <option key={s.name} value={s.name + "|" + s.room + "|" + s.email}>{s.name} ({s.room})</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Your Name"
            value={name}
            onChange={e => setName(e.target.value)}
            className=" p-2 w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition "
            required
          />
          <input
            type="text"
            placeholder="Class/Room Name"
            value={room}
            onChange={e => setRoom(e.target.value)}
            className="p-2 w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            required
          />
          <input
            type="email"
            placeholder="Your Email"
            className="p-2 w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            required
            id="paystack-email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">Pay & Join Class</button>
          {error && <p className="text-red-600">{error}</p>}
        </form>
      ) : !token ? (
        <button onClick={handleSubmit} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 mt-4">Join Live Class</button>
      ) : (
        <LiveKitRoom
          token={token}
          serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
          connect={true}
          data-lk-theme="default"
        >
          <VideoConference />
          <LiveKitChat name={name} />
        </LiveKitRoom>
      )}
    </main>
  );

  function handlePaystack() {
    const emailInput = document.getElementById("paystack-email");
    // @ts-ignore
    const email = emailInput?.value;
    if (!name || !room || !email) {
      setError("Please fill all fields");
      return;
    }
    setError("");
    // @ts-ignore
    const handler = window.PaystackPop && window.PaystackPop.setup({
      key: PAYSTACK_PUBLIC_KEY,
      email,
      amount: 50000 * 100, // 1000 NGN in kobo (change as needed)
      currency: "NGN",
      ref: `liveclass-${room}-${Date.now()}`,
      callback: function (response: any) {
        setPaid(true);
      },
      onClose: function () {
        setError("Payment was not completed");
      },
    });
    if (handler) handler.openIframe();
  }
}