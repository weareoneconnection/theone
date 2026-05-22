function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getOneClawSteps(task: any): any[] {
  return Array.isArray(task?.steps) ? task.steps : [];
}

export function getOneClawPrimaryStep(task: any) {
  return getOneClawSteps(task).find((step) => step?.output?.errorCode || step?.error) || getOneClawSteps(task)[0];
}

export function getOneClawSignal(task: any) {
  const step = getOneClawPrimaryStep(task);
  const output = step?.output || {};
  const errorCode = asText(output.errorCode);
  const retryable = output.retryable;
  const shouldBlockReplyTarget = Boolean(output.shouldBlockReplyTarget);
  const replyToTweetId = asText(output.replyToTweetId);
  const error = asText(step?.error) || asText(output?.receipt?.error);

  if (errorCode === 'X_REPLY_RESTRICTED') {
    return {
      code: errorCode,
      tone: 'blocked',
      title: 'Reply Restricted',
      detail: replyToTweetId
        ? `X refused reply target ${replyToTweetId}. Block this tweet and choose another account.`
        : 'X refused this reply target. Choose another account.',
      retryable: false,
      shouldBlockReplyTarget,
      replyToTweetId,
      error,
    };
  }

  if (errorCode === 'X_CREDITS_DEPLETED') {
    return {
      code: errorCode,
      tone: 'failed',
      title: 'X Credits Depleted',
      detail: 'X API credits are unavailable for this app. Pause automation until credits recover.',
      retryable: false,
      shouldBlockReplyTarget: false,
      replyToTweetId,
      error,
    };
  }

  if (errorCode === 'X_RATE_LIMIT') {
    return {
      code: errorCode,
      tone: 'running',
      title: 'Rate Limited',
      detail: 'X rate limit was hit. Retry later.',
      retryable: true,
      shouldBlockReplyTarget: false,
      replyToTweetId,
      error,
    };
  }

  if (errorCode) {
    return {
      code: errorCode,
      tone: retryable === false ? 'failed' : 'running',
      title: errorCode.replace(/^X_/, '').replaceAll('_', ' '),
      detail: error || 'OneClaw returned an X execution signal.',
      retryable,
      shouldBlockReplyTarget,
      replyToTweetId,
      error,
    };
  }

  return null;
}
