import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../core/types';
import { extractProfileSuggestions } from './profile-suggestions';

function message(
  text: string,
  urls: string[] = [],
  direction: ChatMessage['direction'] = 'incoming',
  timestampMs = 1787961600000,
): ChatMessage {
  return {
    key: `m-${text}`, id: `m-${text}`, conversationId: 'chat-1', direction,
    kind: 'text', text, quotedText: null, sender: 'Partner', timestampRaw: null,
    timestampMs, urls, mediaCount: 0, capturedAt: timestampMs, domOrder: 0,
  };
}

describe('profile suggestions', () => {
  it('separates an Instagram profile from a published content link', () => {
    const suggestions = extractProfileSuggestions([
      message('Mi perfil', ['https://www.instagram.com/creator_name/']),
      message('Publicado', ['https://www.instagram.com/reel/ABC123/']),
    ]);

    expect(suggestions).toMatchObject({
      instagramUsername: 'creator_name',
      instagramProfileUrl: 'https://www.instagram.com/creator_name/',
      publishedUrl: 'https://www.instagram.com/reel/ABC123/',
    });
    expect(suggestions).not.toHaveProperty('publishedDate');
  });

  it('extracts the latest amount only after the other side clearly accepts it', () => {
    const suggestions = extractProfileSuggestions([
      message('Para este video podemos ofrecerte 400 MXN.', [], 'outgoing'),
      message('Perfecto, de acuerdo.', [], 'incoming'),
    ]);

    expect(suggestions.finalPrice).toBe('400 MXN');
  });

  it('does not treat an offer or counteroffer as the final price', () => {
    const suggestions = extractProfileSuggestions([
      message('Para este video podemos ofrecerte 400 MXN.', [], 'outgoing'),
      message('Es muy poco. Yo puedo hacerlo por 600 MXN.', [], 'incoming'),
    ]);

    expect(suggestions.finalPrice).toBeUndefined();
  });

  it('uses the last negotiated amount after explicit acceptance', () => {
    const suggestions = extractProfileSuggestions([
      message('Podemos ofrecerte 400 MXN.', [], 'outgoing'),
      message('Necesito 500 MXN.', [], 'incoming'),
      message('Podemos hacerlo por 450 MXN.', [], 'outgoing'),
      message('Está bien 👍', [], 'incoming'),
    ]);

    expect(suggestions.finalPrice).toBe('450 MXN');
  });
});
