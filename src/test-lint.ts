// Test file for linting

import { Logger } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const testFunction = (): void => {
  const x = 5;
  if (x === 5) {
    Logger.log('x is 5');
  }
};
