import React from 'react';
import { render } from '@testing-library/react';
import App from './App';

test('renders wiki-swarm app without crashing', () => {
  const { container } = render(<App />);
  expect(container).toBeDefined();
});
