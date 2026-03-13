/**
 * Melba V2 — Dual-Partner Match Function
 */

const Anthropic = require("@anthropic-ai/sdk");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function parsePreferences(answers) {
  const moodMap = {
    "🤍 Tender, want to reconnect": "CONNECTION",
    "😄 Playful, light mood":        "PLAYFUL",
    "🔥 Turned on, ready":           "SENSUAL",
    "✨ Curious, open to something new": "PLAYFUL",
  };
  const topicMap = {
    "🕯️ Slow touch & massage":       ["EROTIC_MASSAGE", "MINDFUL_AND_CONNECTED"],
    "💋 Oral pleasure":               ["ORAL_PLEASURE"],
    "🎭 Power, roleplay, sensation":  ["POWER_AND_CONTROL", "ROLE_PLAYING", "SENSORY_PLAY"],
    "🔄 New positions together":      ["NEW_SEX_POSITIONS", "MINDFUL_AND_CONNECTED"],
  };
  const leadsMap = {
    "🌸 Be guided":         "BOTH",
    "⚡ Take the lead":     "HIM",
    "🫶 Discover together": "BOTH",
  };
  const spiceMap = {
    "🌶️ Soft & intimate":   1,
    "🌶️🌶️ A little spicy": 2,
    "🌶️🌶️🌶️ Turn it up":  3,
  };
  return {
    mood:        moodMap[answers.mood]        || "SENSUAL",
    topics:      topicMap[answers.experience] || ["MINDFUL_AND_CONNECTED"],
    who_leads:   leadsMap[answers.leads]      || "BOTH",
    spice_level: spiceMap[answers.spice]      || 1,
  };
}

function reconcilePreferences(prefA, prefB) {
  const moodOrder = ["CONNECTION", "PLAYFUL", "SENSUAL", "INTENSE"];
  const jointMood = moodOrder[Math.min(moodOrder.indexOf(prefA.mood), moodOrder.indexOf(prefB.mood))];
  const jointTopics = [...new Set([...prefA.topics, ...prefB.topics])];
  const jointWhoLeads = (prefA.who_leads === "BOTH" || prefB.who_leads === "BOTH") ? "BOTH" : prefA.who_leads;
  const jointSpice = Math.min(prefA.spice_level, prefB.spice_level);
  return { mood: jointMood, topics: jointTopics, who_leads: jointWhoLeads, spice_level: jointSpice, _partnerA: prefA, _partnerB: prefB };
}

function fallbackMatch(preferences, episodes) {
  const moodOrder = ["CONNECTION", "PLAYFUL", "SENSUAL", "INTENSE"];
  const spiceEmoji = ["🌶️", "🌶️🌶️", "🌶️🌶️🌶️"];
  const targetSpice = spiceEmoji[preferences.spice_level - 1] || "🌶️";
  const scored = episodes.map((ep) => {
    let score = 0;
    if (ep.mood === preferences.mood) score += 30;
    else score += Math.max(0, 15 - Math.abs(moodOrder.indexOf(ep.mood) - moodOrder.indexOf(preferences.mood)) * 5);
    score += ep.topics.filter((t) => preferences.topics.includes(t)).length * 15;
    if (ep.who_is_guided === "BOTH") score += 10;
    else if (ep.who_is_guided === preferences.who_leads) score += 8;
    if (ep.spice === targetSpice) score += 10;
    else if (ep.spice < targetSpice) score += 5;
    if (ep.latest) score += 3;
    return { ep, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].ep;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  try {
    const { answers, episodes } = JSON.parse(event.body);
    const isDual = answers.partnerA && answers.partnerB;
    let preferences;
    if (isDual) {
      preferences = reconcilePreferences(parsePreferences(answers.partnerA), parsePreferences(answers.partnerB));
    } else {
      preferences = parsePreferences(answers);
    }

    const client = new Anthropic();
    const validIds = new Set(episodes.map((e) => e.id));
    const episodeList = episodes.map((e) => ({ id: e.id, name: e.name, mood: e.mood, topics: e.topics, who_is_guided: e.who_is_guided, spice: e.spice }));

    const partnerContext = isDual
      ? `\n\nPARTNER A wanted: mood=${preferences._partnerA.mood}, spice=${preferences._partnerA.spice_level}\nPARTNER B wanted: mood=${preferences._partnerB.mood}, spice=${preferences._partnerB.spice_level}\nJoint: mood=${preferences.mood}, spice=${preferences.spice_level}\nWrite the reason acknowledging BOTH partners.`
      : "";

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: `You are the matching engine for Melba, a couples intimacy app. Return ONLY valid JSON: {"episode_id":"<exact id>","reason":"2 warm sentences. Start with Tonight or You both.${isDual ? " Acknowledge both partners." : ""}"}. NEVER invent an episode_id — copy exactly from the list.`,
      messages: [{ role: "user", content: `Preferences: ${JSON.stringify({ mood: preferences.mood, topics: preferences.topics, who_leads: preferences.who_leads, spice_level: preferences.spice_level })}${partnerContext}\n\nEpisodes:\n${JSON.stringify(episodeList)}` }],
    });

    const clean = message.content[0].text.trim().replace(/```json\n?|```\n?/g, "").trim();
    const result = JSON.parse(clean);
    const matchedEp = (result.episode_id && validIds.has(result.episode_id))
      ? episodes.find((e) => e.id === result.episode_id)
      : fallbackMatch(preferences, episodes);

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        episode_id: matchedEp.id, episode_name: matchedEp.name,
        reason: result.reason || "Tonight is the perfect moment to explore something beautiful together.",
        image: matchedEp.image || "", spice: matchedEp.spice || "🌶️",
        practice_tags: matchedEp.practice_tags || [], who_is_guided: matchedEp.who_is_guided || "", is_joint: isDual,
      }),
    };
  } catch (err) {
    console.error("Match error:", err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
