import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.METERED_API_KEY;
  const appName = process.env.METERED_APP_NAME; // ex: myapp.metered.live

  const fallbackServers = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
      ],
    },
  ];

  if (!apiKey || !appName) {
    return NextResponse.json(fallbackServers);
  }

  try {
    const response = await fetch(
      `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
    );

    if (!response.ok) {
      throw new Error(`Metered API error: ${response.statusText}`);
    }

    const iceServers = await response.json();
    return NextResponse.json(iceServers);
  } catch (error) {
    console.warn("⚠️ Utilisation du fallback STUN Google:", error);
    return NextResponse.json(fallbackServers);
  }
}