const svgs = {
  circulo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="45" ry="15" fill="none" stroke="black" stroke-width="5"/></svg>',
  circuloponto: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="45" ry="15" fill="none" stroke="black" stroke-width="5"/><circle cx="50" cy="50" r="5" fill="black"/></svg>'
};
for(const k in svgs) {
  console.log(k + ': data:image/svg+xml;base64,' + Buffer.from(svgs[k]).toString('base64'));
}
