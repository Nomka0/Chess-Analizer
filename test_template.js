// Quick test of the template logic in server.js
const language = 'en';
const isEn = language === 'en';
const mappedClassification = 'excellent';
const cpLoss = 37;
const analysisData = { generalExplanation: 'Test explanation.' };
const sanUserMove = '1. e4';

console.log('DEBUG: language="en', 'isEn=' + isEn, 'template=' + `**1. e4** ${isEn ? 'is an' : 'es un/una'} **excellent**`);

const generatedHtml = `**${sanUserMove}** ${isEn ? 'is an' : 'es un/una'} **${mappedClassification}** (${cpLoss}cp). ${analysisData.generalExplanation}\n\n`;

console.log('Generated:', generatedHtml);

// Also test with Spanish
const language2 = 'es';
const isEn2 = language2 === 'en';
const generatedHtml2 = `**${sanUserMove}** ${isEn2 ? 'is an' : 'es un/una'} **${mappedClassification}** (${cpLoss}cp). ${analysisData.generalExplanation}\n\n`;

console.log('Spanish:', generatedHtml2);