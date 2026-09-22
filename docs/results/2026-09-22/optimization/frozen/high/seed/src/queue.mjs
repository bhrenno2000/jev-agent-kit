export const serialQueue = () => {
  let chain = Promise.resolve();
  return (work) => {
    const next = chain.then(work);
    chain = next.catch(() => {});
    return next;
  };
};
