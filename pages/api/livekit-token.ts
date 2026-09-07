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

import type { NextApiRequest, NextApiResponse } from 'next';
import { AccessToken } from 'livekit-server-sdk';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY!;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET!;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { identity, name, room, isTeacher } = req.body;
  if (!identity || !room) {
    return res.status(400).json({ error: 'Missing identity or room' });
  }

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name,
  });

  at.addGrant({
    room,
    roomJoin: true,
    canPublish: !!isTeacher, // Only teacher can publish video/audio
    canSubscribe: true,
    canPublishData: true, // Allow chat for all
  });

  const token = await at.toJwt();
  res.status(200).json({ token });
}