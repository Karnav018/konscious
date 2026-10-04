import { describe, expect, it } from 'vitest'

import { fileKind, fileName, withAttached } from './attach'

describe('fileKind', () => {
  it('spots images whatever the case', () => {
    for (const p of ['/a/shot.png', '/a/photo.JPG', '/a/x.jpeg', '/a/loop.gif', '/a/i.webp', '/a/old.bmp']) {
      expect(fileKind(p)).toBe('image')
    }
  })

  it('separates PDFs from everything else', () => {
    expect(fileKind('/a/report.pdf')).toBe('pdf')
    expect(fileKind('/a/REPORT.PDF')).toBe('pdf')
    expect(fileKind('/a/main.rs')).toBe('file')
    expect(fileKind('/a/noext')).toBe('file')
  })
})

describe('fileName', () => {
  it('takes the last segment on either platform', () => {
    expect(fileName('/Users/me/shot 2.png')).toBe('shot 2.png')
    expect(fileName('C:\\Users\\me\\report.pdf')).toBe('report.pdf')
    expect(fileName('plain.txt')).toBe('plain.txt')
  })

  it('survives a trailing separator and an empty path', () => {
    expect(fileName('/Users/me/folder/')).toBe('folder')
    expect(fileName('')).toBe('')
  })
})

describe('withAttached', () => {
  it('appends in the order they were dropped', () => {
    expect(withAttached([], ['/a.png', '/b.png'])).toEqual(['/a.png', '/b.png'])
    expect(withAttached(['/a.png'], ['/b.png'])).toEqual(['/a.png', '/b.png'])
  })

  it('moves a file dropped again to the end rather than repeating it', () => {
    expect(withAttached(['/a.png', '/b.png'], ['/a.png'])).toEqual(['/b.png', '/a.png'])
  })

  it('keeps only the most recent, so a long session cannot grow a wall of chips', () => {
    const many = Array.from({ length: 20 }, (_, i) => `/f${i}.png`)
    const kept = withAttached([], many, 12)
    expect(kept).toHaveLength(12)
    expect(kept[0]).toBe('/f8.png')
    expect(kept[kept.length - 1]).toBe('/f19.png')
  })
})
