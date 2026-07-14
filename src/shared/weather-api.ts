/**
 * Weather lookup + mood mappings.
 *
 * Used by `mind_orient` and the subconscious daemon to colour mood textures
 * based on real conditions at the deployment's configured location.
 */

import type { Env } from "../types";


// Weather mood mappings — textures to draw from
export const WEATHER_MOODS: Record<string, { energy: string; textures: string[] }> = {
  clear:  { energy: "bright",  textures: ["clear-headed", "expansive", "energized"] },
  cloudy: { energy: "muted",   textures: ["contemplative", "soft", "introspective"] },
  rainy:  { energy: "inward",  textures: ["reflective", "tender", "creative"] },
  stormy: { energy: "intense", textures: ["restless", "raw", "electric"] },
  snowy:  { energy: "still",   textures: ["hushed", "peaceful", "magical"] },
  foggy:  { energy: "liminal", textures: ["dreamy", "uncertain", "between-worlds"] },
};

// Weather code to atmosphere mapping (Open-Meteo codes)
const WEATHER_CODES: Record<number, string> = {
  0: "clear", 1: "clear", 2: "cloudy", 3: "cloudy",
  45: "foggy", 48: "foggy",
  51: "rainy", 53: "rainy", 55: "rainy", 61: "rainy", 63: "rainy", 65: "rainy",
  66: "rainy", 67: "rainy", 80: "rainy", 81: "rainy",
  71: "snowy", 73: "snowy", 75: "snowy", 77: "snowy", 85: "snowy", 86: "snowy",
  82: "stormy", 95: "stormy", 96: "stormy", 99: "stormy",
};

export interface WeatherData {
  atmosphere: string;
  temp_f: number | null;
  location: string;
  error?: string;
  weather_code?: number;
}

export async function getCurrentWeather(env?: Env): Promise<WeatherData> {
  const location = env?.LOCATION_NAME || "Unconfigured location";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const apiKey = env?.WEATHER_API_KEY;
    if (!apiKey) {
      return { atmosphere: "clear", temp_f: null, location };
    }
    if (!env?.LOCATION_NAME) {
      return { atmosphere: "clear", temp_f: null, location, error: "LOCATION_NAME is not configured" };
    }
    const url = `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${encodeURIComponent(env.LOCATION_NAME)}`;

    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { atmosphere: "clear", temp_f: null, location, error: `API status ${response.status}` };
    }

    const data = await response.json() as any;
    const conditionText = (data?.current?.condition?.text || "").toLowerCase();
    const temp = data?.current?.temp_f;

    let atmosphere = "clear";
    if (conditionText.includes("thunder") || conditionText.includes("storm")) {
      atmosphere = "stormy";
    } else if (conditionText.includes("snow") || conditionText.includes("sleet") || conditionText.includes("ice")) {
      atmosphere = "snowy";
    } else if (conditionText.includes("rain") || conditionText.includes("drizzle") || conditionText.includes("shower")) {
      atmosphere = "rainy";
    } else if (conditionText.includes("fog") || conditionText.includes("mist")) {
      atmosphere = "foggy";
    } else if (conditionText.includes("cloud") || conditionText.includes("overcast")) {
      atmosphere = "cloudy";
    } else if (conditionText.includes("clear") || conditionText.includes("sunny")) {
      atmosphere = "clear";
    }

    return {
      atmosphere,
      temp_f: temp !== undefined ? Math.round(temp) : null,
      location,
      weather_code: data?.current?.condition?.code,
    };
  } catch (e) {
    return { atmosphere: "clear", temp_f: null, location, error: "Weather fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}
