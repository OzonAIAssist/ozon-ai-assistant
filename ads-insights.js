(function(root){
 'use strict';
 const n=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
 const ratio=(a,b,m=1)=>n(a)!==null&&n(b)!==null&&b>0?a/b*m:null;
 function metrics(s={}){const spend=n(s.spend),clicks=n(s.clicks),orders=n(s.orders),revenue=n(s.revenue),views=n(s.impressions),carts=n(s.carts);return {spend,clicks,orders,revenue,views,carts,ctr:ratio(clicks,views,100),cpc:ratio(spend,clicks),cartRate:ratio(carts,clicks,100),orderRate:ratio(orders,clicks,100),cpa:ratio(spend,orders),aov:ratio(revenue,orders),drr:ratio(spend,revenue,100),roas:ratio(revenue,spend)};}
 function analyze(stat,previous,options={}){
  const m=metrics(stat),p=previous?metrics(previous):null,target=Number(options.targetDrr),validTarget=Number.isFinite(target)&&target>0&&target<=100,complete=['spend','clicks','orders','revenue'].every(k=>m[k]!==null),fresh=!options.stale,active=options.status==='active',actions=[];
  const add=(priority,title,evidence,action)=>actions.push({priority,title,evidence,action});
  let verdict='Сначала проверьте данные',confidence='Недостаточно данных',proposal='hold';
  if(!complete)add('high','Неполный отчёт', 'Не все расходы, клики, заказы или выручка подтверждены.','Обновите статистику. Не повышайте бюджет по неполному отчёту.');
  if(!fresh)add('high','Сохранённая статистика','Отчёт устарел или обновляется.','Получите свежий отчёт перед изменением лимитов.');
  if(!active)add('info','Кампания не активна','Текущий статус не соответствует активной кампании.','Проверьте причину остановки и наличие товаров. Ассистент не запускает кампанию.');
  if(complete){confidence=m.orders>=10?'Больше наблюдений':m.orders>=3?'Ограниченная выборка':'Малая выборка';
   if(m.spend===0){verdict='Нет расходов в выбранном периоде';add('info','Проверьте открутку','Подтверждённый расход равен нулю.','Проверьте статус, остатки, бюджет и участие товара в показах.');}
   else if(m.orders===0){verdict=m.clicks>=30?'Есть расход без заказов':'Продолжайте ограниченный тест';add(m.clicks>=30?'high':'info','Расход пока не принёс заказов',String(m.clicks)+' кликов, '+String(m.spend)+' ₽ расхода, 0 заказов.','Не масштабируйте расход; проверьте карточку, цену, доставку и соответствие запросов. Учитывайте задержку атрибуции.');if(m.carts>0)add('medium','Интерес не дошёл до заказа',String(m.carts)+' добавлений в корзину.','Проверьте конечную цену и условия доставки. Корзины не доказывают окупаемость.');}
   else if(validTarget&&m.drr!==null){if(m.drr>target){verdict='ДРР выше цели';add('high','Сначала снизьте неэффективный расход','ДРР '+m.drr.toFixed(1)+'% при цели '+target+'%.','Проверьте товарные отчёты и запросы; проверьте ставки. Не сокращайте все кампании одинаково.');if(fresh&&active&&m.orders>=5&&!options.partial)proposal='reduce';}else{verdict='ДРР укладывается в цель';add('info','Сохраняйте контроль расходов','ДРР '+m.drr.toFixed(1)+'% при цели '+target+'%.','Перед ростом проверьте маржу, наличие товара и отсутствие задержки атрибуции.');}}
   else add('medium','Окупаемость не подтверждена','Выручка равна нулю или целевой ДРР не задан.','Проверьте выручку рекламного отчёта и задайте свою цель.');
  }
  if(options.partial)add('info','Период ещё не завершён','В выбранный диапазон входит текущий день.','Сегодняшний расход и заказы ещё изменятся. Числовой сценарий изменения лимита отключён.');
  const comparisons=[];
  if(p){for(const [key,label,unit] of [['spend','Расход','₽'],['cpc','Цена клика','₽'],['ctr','CTR','%'],['cartRate','Клик → корзина','%'],['orderRate','Клик → заказ','%'],['drr','ДРР','%']]){const a=m[key],b=p[key];comparisons.push({key,label,unit,current:a,previous:b,change:a!==null&&b!==null&&b>0?(a/b-1)*100:null});}
   if(m.cpc!==null&&p.cpc>0&&m.cpc>p.cpc*1.2)add('medium','Клик стал дороже','Цена клика выросла более чем на 20% относительно предыдущего равного периода.','Сравните ставки, состав товаров и запросов. Рост CPC сам по себе не доказывает ухудшение прибыли.');
   if(m.ctr!==null&&p.ctr>0&&m.views>=100&&p.views>=100&&m.ctr<p.ctr*.8)add('medium','Снизилась кликабельность','CTR ниже предыдущего равного периода более чем на 20%.','Проверьте главное фото, заголовок, цену и релевантность показов.');
   if(m.orderRate!==null&&p.orderRate>0&&m.clicks>=30&&p.clicks>=30&&m.orderRate<p.orderRate*.8)add('medium','Снизилась конверсия в заказ','Конверсия клика в заказ ниже предыдущего периода более чем на 20%.','Проверьте цену, отзывы, остатки и срок доставки. Причина требует проверки, это не доказанный диагноз.');
   const previousComplete=['spend','clicks','orders','revenue'].every(k=>p[k]!==null);
   if(complete&&previousComplete&&fresh&&active&&!options.partial&&!options.previousStale&&validTarget&&m.orders>=10&&p.orders>=5&&m.drr!==null&&p.drr!==null&&m.drr<=target*.8&&m.drr<=p.drr&&options.strategy!=='efficient')proposal='grow';
  }
  if(!p)add('info','Нет сравнения периодов','Получен только текущий отчёт.','Загрузите предыдущий равный период для анализа динамики. Без него ассистент не предлагает увеличение лимита.');
  if(options.previousStale)add('info','Предыдущий отчёт сохранённый','Сравнение доступно, но предыдущий ответ Ozon устарел.','Обновите его перед проверкой сценария роста.');
  const cpcCeiling=validTarget&&m.revenue>0&&m.clicks>0?m.revenue/m.clicks*target/100:null,cpaCeiling=validTarget&&m.aov!==null?m.aov*target/100:null,requiredRevenue=validTarget&&m.spend!==null?m.spend/(target/100):null;
  const daily=Number(options.daily),weekly=Number(options.weekly),activeDays=Number(options.activeDays),hasPlan=daily>0&&weekly>0&&activeDays>0,baseline=hasPlan?Math.min(daily,weekly/activeDays):null;
  const factor=proposal==='reduce'?.9:proposal==='grow'?(options.strategy==='growth'?1.1:1.05):1;
  const proposedDaily=baseline===null?null:Math.floor(Math.min(baseline*factor,weekly/activeDays)*100)/100;
  return {m,p,verdict,confidence,actions,comparisons,proposal,proposedDaily,baseline,cpcCeiling,cpaCeiling,requiredRevenue};
 }
 const api={metrics,analyze};if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root.document)root.HogarAdsInsights=api;
})(typeof window!=='undefined'?window:globalThis);
