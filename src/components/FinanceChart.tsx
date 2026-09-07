"use client"
import { FaEllipsisH } from "react-icons/fa";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const data = [
  {
    name: 'Jan',
    income: 4000,
    expense: 2400,
  },
  {
    name: 'Feb',
    income: 3000,
    expense: 1398,
  },
  {
    name: 'Mar',
    income: 2000,
    expense: 9800,
  },
  {
    name: 'Apr',
    income: 2780,
    expense: 3908,
  },
  {
    name: 'May',
    income: 1890,
    expense: 4800,
  },
  {
    name: 'Jun',
    income: 2390,
    expense: 3800,
  },
  {
    name: 'Jul',
    income: 3490,
    expense: 4300,
  },
  {
    name: 'Aug',
    income: 3490,
    expense: 4300,
  },
  {
    name: 'Sep',
    income: 3490,
    expense: 4300,
  },
  {
    name: 'Oct',
    income: 3490,
    expense: 4300,
  },
  {
    name: 'Nov',
    income: 3490,
    expense:4300,
  },
  {
    name: 'Dec',
    income: 3490,
    expense: 4300,
  },
];


const FinanceChart = () => {
  return (
    /* FINANCE CHART */ 
    <div className='bg-white rounded-2xl dark:rounded-3xl w-full h-full p-4 bg-dark '>
      
      { /* TITLE AND MORE-IMAGE ICON CONTAINER */ }
      <div className='flex justify-between items-center '>

        { /* TITLE */ }
        <h1 className=' text-lg font-semibold'>Finance</h1>

        { /* MORE ICON */ }
        < FaEllipsisH width={20} height={20} className='cursor-pointer text-gray-400'/>

      </div>

      { /* TITLE */ }
     <ResponsiveContainer width="100%" height="90%">
        <LineChart
          width={500}
          height={300}
          data={data}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
          <XAxis dataKey="name"  axisLine={false} tick={{fill:"#6b7280"}} tickLine={false} tickMargin={10}/>
          <YAxis axisLine={false} tick={{fill:"#6b7280"}} tickLine={false} tickMargin={10}  />
          <Tooltip contentStyle={{ borderRadius: '10px', borderColor: 'lightgray', backgroundColor:'grey'}}  />
          <Legend align='center' verticalAlign='top' wrapperStyle={{paddingTop: '10px', paddingBottom: '30px'}}/>
          <Line 
          type="monotone" 
          dataKey="income" 
          stroke="#C3EBFA" 
          strokeWidth={5} />
          <Line 
          type="monotone" 
          dataKey="expense" 
          stroke="#fae27c" 
          strokeWidth={5}
          />
        </LineChart>
    </ResponsiveContainer>

    </div>
  )
}

export default FinanceChart