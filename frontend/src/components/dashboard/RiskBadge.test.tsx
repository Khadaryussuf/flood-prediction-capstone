import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RiskBadge } from './RiskBadge'
import { RiskGauge } from './RiskGauge'
import { fixtures } from '@/test/mockApi'

describe('RiskBadge', () => {
  it.each([
    ['low', 'Low intensity'],
    ['moderate', 'Medium intensity'],
    ['high', 'High intensity'],
  ])('shows "%s" as text, not only colour', (level, text) => {
    render(<RiskBadge level={level} />)
    const badge = screen.getByText(text)
    expect(badge.closest('[data-risk]')).toHaveAttribute('data-risk', level)
  })

  it('shows an unknown class name as it came from the API', () => {
    render(<RiskBadge level="extreme" />)
    expect(screen.getByText('extreme intensity')).toBeInTheDocument()
  })
})

describe('RiskGauge', () => {
  it('builds its bands from the API thresholds and describes the value', () => {
    const { thresholds, highest_risk } = fixtures.meta
    render(<RiskGauge valueMm={0.057} level="low" thresholds={thresholds} highestRisk={highest_risk} />)
    const gauge = screen.getByRole('img')
    expect(gauge).toHaveAccessibleName(
      'Gauge: 0.06 mm on a 0 to 10 mm scale. Low from 0 to 2.5 mm; Medium from 2.5 to 7.6 mm; High from 7.6 to 10 mm.',
    )
    expect(screen.getByText('≥10')).toBeInTheDocument()
  })
})
