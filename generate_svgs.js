const svgs = {
  ponto: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="7" fill="black"/></svg>',
  cruz: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="47.5" y="10" width="5" height="80" fill="black"/><rect x="10" y="47.5" width="80" height="5" fill="black"/></svg>',
  circulo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="none" stroke="black" stroke-width="5"/></svg>',
  circuloponto: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="none" stroke="black" stroke-width="5"/><circle cx="50" cy="50" r="7" fill="black"/></svg>',
  chevron: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polyline points="20,60 50,30 80,60" fill="none" stroke="black" stroke-width="5" stroke-linecap="square"/></svg>',
  cruzt: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="47.5" y="47.5" width="5" height="42.5" fill="black"/><rect x="10" y="47.5" width="80" height="5" fill="black"/></svg>',
  letrax: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><line x1="20" y1="20" x2="80" y2="80" stroke="black" stroke-width="5" stroke-linecap="square"/><line x1="80" y1="20" x2="20" y2="80" stroke="black" stroke-width="5" stroke-linecap="square"/></svg>',
  quadrado: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="25" y="25" width="50" height="50" fill="none" stroke="black" stroke-width="5"/></svg>',
  diamante: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,20 80,50 50,80 20,50" fill="black"/></svg>'
};
for(const k in svgs) {
  console.log(k + ': data:image/svg+xml;base64,' + Buffer.from(svgs[k]).toString('base64'));
}
