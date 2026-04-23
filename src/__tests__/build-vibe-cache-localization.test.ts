import { describe, expect, it } from 'vitest'
import {
  buildLocalizationPrompt,
  extractLocalizableTexts,
  applyTranslations,
} from '../pipeline/build_cache'
import type { Neighborhood, Waypoint, Task } from '../schemas/cityAtlas'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const neighborhood: Neighborhood = {
  id: 'tokyo-shimokitazawa',
  city_id: 'tokyo',
  name: { en: 'Shimokitazawa' },
  summary: { en: 'A bohemian hub of vintage shops and indie theaters' },
  lat: 35.661,
  lng: 139.668,
  trending_score: 85,
}

const waypoint: Waypoint = {
  id: 'tokyo-shimokitazawa-bear-pond',
  city_id: 'tokyo',
  neighborhood_id: 'tokyo-shimokitazawa',
  name: { en: 'Bear Pond Espresso' },
  description: { en: 'Cult-status espresso bar' },
  type: 'drink',
  lat: 35.661,
  lng: 139.668,
  trending_score: 92,
}

const task: Task = {
  id: 'tokyo-shimokitazawa-bear-pond-task-0',
  waypoint_id: 'tokyo-shimokitazawa-bear-pond',
  title: { en: 'Espresso Art' },
  prompt: { en: 'Photograph the latte art at Bear Pond' },
  points: 10,
  duration_minutes: 5,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 2 — Localization Pipeline', () => {
  describe('buildLocalizationPrompt', () => {
    it('includes the target language name and locale code', () => {
      const prompt = buildLocalizationPrompt('ja', [{ key: 'test', en: 'Hello' }])
      expect(prompt).toContain('Japanese')
      expect(prompt).toContain('(ja)')
    })

    it('includes all text keys in the prompt', () => {
      const texts = [
        { key: 'n:tokyo:name', en: 'Shimokitazawa' },
        { key: 'w:bear-pond:name', en: 'Bear Pond Espresso' },
      ]
      const prompt = buildLocalizationPrompt('ko', texts)
      expect(prompt).toContain('n:tokyo:name')
      expect(prompt).toContain('w:bear-pond:name')
      expect(prompt).toContain('Shimokitazawa')
      expect(prompt).toContain('Bear Pond Espresso')
    })

    it('instructs natural phrasing and proper noun handling', () => {
      const prompt = buildLocalizationPrompt('ja', [{ key: 'test', en: 'Hello' }])
      expect(prompt).toContain('natural, colloquial')
      expect(prompt).toContain('established local spellings')
    })
  })

  describe('extractLocalizableTexts', () => {
    it('extracts name and summary from neighborhoods', () => {
      const texts = extractLocalizableTexts([neighborhood], [], [])
      expect(texts).toContainEqual({ key: 'n:tokyo-shimokitazawa:name', en: 'Shimokitazawa' })
      expect(texts).toContainEqual({ key: 'n:tokyo-shimokitazawa:summary', en: 'A bohemian hub of vintage shops and indie theaters' })
    })

    it('extracts name and description from waypoints', () => {
      const texts = extractLocalizableTexts([], [waypoint], [])
      expect(texts).toContainEqual({ key: 'w:tokyo-shimokitazawa-bear-pond:name', en: 'Bear Pond Espresso' })
      expect(texts).toContainEqual({ key: 'w:tokyo-shimokitazawa-bear-pond:description', en: 'Cult-status espresso bar' })
    })

    it('extracts title and prompt from tasks', () => {
      const texts = extractLocalizableTexts([], [], [task])
      expect(texts).toContainEqual({ key: 't:tokyo-shimokitazawa-bear-pond-task-0:title', en: 'Espresso Art' })
      expect(texts).toContainEqual({ key: 't:tokyo-shimokitazawa-bear-pond-task-0:prompt', en: 'Photograph the latte art at Bear Pond' })
    })

    it('returns combined texts from all entity types', () => {
      const texts = extractLocalizableTexts([neighborhood], [waypoint], [task])
      // 2 from neighborhood + 2 from waypoint + 2 from task = 6
      expect(texts).toHaveLength(6)
    })
  })

  describe('applyTranslations', () => {
    it('applies translations to neighborhood name and summary', () => {
      const n = { ...neighborhood, name: { ...neighborhood.name }, summary: { ...neighborhood.summary! } }
      const translations = {
        'n:tokyo-shimokitazawa:name': '下北沢',
        'n:tokyo-shimokitazawa:summary': 'ヴィンテージショップとインディーシアターのボヘミアンハブ',
      }
      applyTranslations('ja', translations, [n], [], [])
      expect(n.name).toHaveProperty('ja', '下北沢')
      expect(n.summary).toHaveProperty('ja', 'ヴィンテージショップとインディーシアターのボヘミアンハブ')
    })

    it('applies translations to waypoint name and description', () => {
      const w = { ...waypoint, name: { ...waypoint.name }, description: { ...waypoint.description! } }
      const translations = {
        'w:tokyo-shimokitazawa-bear-pond:name': '베어 폰드 에스프레소',
        'w:tokyo-shimokitazawa-bear-pond:description': '컬트 에스프레소 바',
      }
      applyTranslations('ko', translations, [], [w], [])
      expect(w.name).toHaveProperty('ko', '베어 폰드 에스프레소')
      expect(w.description).toHaveProperty('ko', '컬트 에스프레소 바')
    })

    it('applies translations to task title and prompt', () => {
      const t = { ...task, title: { ...task.title }, prompt: { ...task.prompt } }
      const translations = {
        't:tokyo-shimokitazawa-bear-pond-task-0:title': 'Arte del Espresso',
        't:tokyo-shimokitazawa-bear-pond-task-0:prompt': 'Fotografía el arte latte en Bear Pond',
      }
      applyTranslations('es', translations, [], [], [t])
      expect(t.title).toHaveProperty('es', 'Arte del Espresso')
      expect(t.prompt).toHaveProperty('es', 'Fotografía el arte latte en Bear Pond')
    })

    it('skips keys not present in translations', () => {
      const n = { ...neighborhood, name: { ...neighborhood.name } }
      applyTranslations('fr', {}, [n], [], [])
      expect(n.name).not.toHaveProperty('fr')
    })
  })
})
