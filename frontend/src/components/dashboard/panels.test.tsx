import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { LimitationsSheet } from './LimitationsSheet'
import { ModelComparison } from './ModelComparison'
import { PredictionTimeline } from './PredictionTimeline'
import { WindowChart } from './WindowChart'
import { caughtMoreThanServed, withinSeedSpread } from '@/lib/comparison'
import type { Comparison } from '@/lib/types'
import { fixtures } from '@/test/mockApi'

const { comparison, meta, predict0, predictions, replay0 } = fixtures
const results = comparison as Comparison

describe('WindowChart', () => {
  it('lists the 24 input hours, then the predicted and actual next hour', () => {
    render(<WindowChart meta={meta} replay={replay0} prediction={predict0} />)
    const rows = within(screen.getByTestId('window-table')).getAllByRole('row')
    expect(rows).toHaveLength(26)
    expect(rows[0]).toHaveTextContent('2 Apr 2025, 02:00')
    expect(rows[0]).toHaveTextContent(`${replay0.readings[0].precipitation.toFixed(2)} mm`)
    expect(rows[24]).toHaveTextContent('Predicted for 3 Apr 2025, 02:00')
    expect(rows[24]).toHaveTextContent('0.06 mm')
    expect(rows[25]).toHaveTextContent('Actual at 3 Apr 2025, 02:00')
    expect(rows[25]).toHaveTextContent('0.00 mm')
  })

  it('offers the other input features as keyboard-reachable tabs', async () => {
    const user = userEvent.setup()
    render(<WindowChart meta={meta} replay={replay0} prediction={predict0} />)
    await user.click(screen.getByRole('tab', { name: 'Wind' }))
    expect(screen.getByText(/Wind speed \(km\/h\)/)).toBeInTheDocument()
  })
})

describe('PredictionTimeline', () => {
  it('lists rows oldest first with a text class, and the real Moderate row', () => {
    render(<PredictionTimeline meta={meta} predictions={predictions} sessionHours={{}} error={null} />)
    const rows = within(screen.getByTestId('timeline-table')).getAllByRole('row')
    expect(rows).toHaveLength(3) // header + 2 rows
    expect(rows[1]).toHaveTextContent('0.06 mm')
    expect(rows[1]).toHaveTextContent('Low')
    expect(rows[2]).toHaveTextContent('4.03 mm')
    expect(rows[2]).toHaveTextContent('Moderate')
  })

  it('says predictions may come from an earlier model and when times are from', () => {
    render(<PredictionTimeline meta={meta} predictions={predictions} sessionHours={{}} error={null} />)
    expect(screen.getByText(/may come from a previously served model/)).toBeInTheDocument()
    expect(screen.getByText(/when the request was made, not the weather hour/)).toBeInTheDocument()
    expect(screen.getByTestId('latest-prediction')).toHaveTextContent('Replay hour: not recorded')
  })

  it('shows the replay hour for a prediction made since the page loaded', () => {
    const newest = predictions[0]
    render(
      <PredictionTimeline
        meta={meta}
        predictions={predictions}
        sessionHours={{ [newest.id]: '2025-05-12T17:00:00' }}
        error={null}
      />,
    )
    expect(screen.getByTestId('latest-prediction')).toHaveTextContent('Replay hour: 12 May 2025, 17:00')
  })

  it('has an empty state and an error state', () => {
    const { rerender } = render(<PredictionTimeline meta={meta} predictions={[]} sessionHours={{}} error={null} />)
    expect(screen.getByText('No predictions stored yet.')).toBeInTheDocument()
    rerender(<PredictionTimeline meta={meta} predictions={null} sessionHours={{}} error="/predictions: 500" />)
    expect(screen.getByText('/predictions: 500')).toBeInTheDocument()
  })
})

describe('ModelComparison', () => {
  it('renders every model from the API, with baselines and the served model marked', () => {
    render(<ModelComparison comparison={results} error={null} />)
    const table = screen.getByTestId('comparison-table')
    for (const model of results.models) {
      const row = table.querySelector(`[data-model="${model.model}"]`) as HTMLElement
      expect(row).toHaveTextContent(model.val_rmse_mm.toFixed(4))
      expect(row).toHaveTextContent(model.test_rmse_mm.toFixed(4))
      expect(row).toHaveTextContent(`${model.test_heavy_hit}/${model.test_heavy_actual}`)
      if (model.seeds) {
        expect(row).toHaveTextContent(`${model.seeds.mean.test_rmse_mm.toFixed(4)} ± ${model.seeds.sd.test_rmse_mm.toFixed(4)}`)
      } else {
        expect(within(row).getAllByText('single run')).toHaveLength(2)
        expect(within(row).getByText('Baseline')).toBeInTheDocument()
      }
    }
    expect(within(table).getAllByText('Served')).toHaveLength(1)
    expect(table.querySelector('[data-model="CNN-LSTM"]')).toHaveTextContent('Served')
  })

  it('states the awkward results, computed from the data', () => {
    expect(caughtMoreThanServed(results.models)).toBe(
      'Persistence (12/35) and ARIMA (9/35) caught more heavy hours than the served CNN-LSTM (7/35).',
    )
    expect(withinSeedSpread(results.models)).toBe(
      "CNN-LSTM and BiLSTM can't be told apart on test RMSE: the gap of 0.0002 mm is smaller than the larger seed SD of 0.0037 mm.",
    )
  })
})

describe('LimitationsSheet', () => {
  it('opens from the keyboard and uses the real numbers', async () => {
    const user = userEvent.setup()
    render(<LimitationsSheet meta={meta} comparison={results} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    screen.getByRole('button', { name: 'Limitations' }).focus()
    await user.keyboard('{Enter}')

    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveTextContent('A replay, not live')
    expect(sheet).toHaveTextContent('Only 14 validation hours and 35 test hours')
    expect(sheet).toHaveTextContent('highest test prediction is 4.31 mm, against a highest actual of 9.30 mm')
    expect(sheet).toHaveTextContent('never reaches the high class')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
