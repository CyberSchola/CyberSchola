"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form";
import { z } from "zod"
import InputField from "../InputField";


/* Schema for Form validation */
const schema = z.object({
  username: z
  .string()
  .min(3, { message: 'Username must be at least 3 characters long!' })
  .max(20, { message: 'Username must be at most 20 characters long!' }),

  email: z.email({message:"Invalid Email address!"}),

  password: z.string().min(8, { message: 'Password must be at least 8 characters long!' }),

  firstName: z.string().min(1, { message: 'First Name is required!' }),

  lastName: z.string().min(1, { message: 'Last Name is required!' }),

  phone: z.string().min(1, { message: 'Phone Number is required!' }),

  address: z.string().min(1, { message: 'Address is required!' }),

  studentName: z.string().min(1, { message: 'Student Name is required!' }),

  sex: z.enum( [ "male", "female" ], {message: "Sex is required!"}),
});

{ /* ZOD */ }
type Inputs = z.infer<typeof schema>


const ParentForm = ( { type, data }: { type: "create" | "update"; data?: any; }) => {

  { /* ZOD */ }
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Inputs> ({
    resolver: zodResolver(schema),
  });


  const onSubmit = handleSubmit( (data) => {
    console.log(data);
  } )


  return (
    
    /* FORM */
    <form className=" flex flex-col gap-8 " onSubmit={onSubmit} >

      { /* CONDITION FOR FORM HEADING */ }
      { type === "create" ? < h1 className="text-xl font-semibold">Create A New Parent</h1> : < h1 className="text-xl font-semibold">Update Parent</h1> }

      { /* FORM MODAL LABEL 1 */ }
      <span className="text-xs text-gray-400 font-medium">
        Authentication Information
      </span>

      { /* AUTHENTICATION INPUTS MAIN CONTAINER */ }
      <div className="flex justify-between flex-wrap gap-4 ">

        { /* AUTHENTICATION INFORMATION INPUTS */ }
        <InputField label="Username" name="username" defaultValue= {data?.name} register={register} error={errors.username} />

        <InputField label="Email" name="email" type="email" defaultValue= {data?.email} register={register} error={errors.email} />

        <InputField label="Password" name="password" type="password" defaultValue= {data?.password} register={register} error={errors.password} />

      </div>
      
      { /* FORMA MODAL LABEL 2 */ }
      <span className="text-xs text-gray-400 font-medium">
        Personal Information
      </span>

      { /* PERSONAL INFO INPUTS MAIN CONTAINER */ }
      <div className="flex justify-between flex-wrap gap-4  relative">

        { /* PERSONAL INFORMATION INPUTS */ }
        <InputField label="First Name" name="firstName" defaultValue= {data?.name} register={register} error={errors.firstName} />

        <InputField label="Last Name" name="lastName" defaultValue= {data?.lastName} register={register} error={errors.lastName} />

       <InputField label="Phone" name="phone" defaultValue= {data?.phone} register={register} error={errors.phone} />

        <InputField label="Address" name="address" defaultValue= {data?.address} register={register} error={errors.address} />

      
        { /* STUDENT NAME MAIN CONTAINER */ }
        <div className=" flex flex-col gap-2 w-full md:w-1/4 ">

          <label className=" text-xs text-gray-500 ">Student Name</label>

          <input type="text" {...register("studentName")} defaultValue={data?.students} className=" ring-[1.5px] ring-gray-300 p-2 rounded-md text-sm w-auto " />
        
          {errors.studentName?.message && <p className=" text-xs text-red-400" >{errors.studentName.message.toString() }</p>}
        
        </div>
        
      

        { /* SEX OPTIONS MAIN CONTAINER */ }
        <div className=" flex flex-col gap-2 w-full md:w-1/4 ">

          { /* SEX LABEL */ }
          <label className=" text-xs text-gray-500 ">Sex</label>

          { /* SEX OPTIONS */ }
          <select className=" ring-[1.5px] ring-gray-300 p-2 rounded-md text-sm w-full flex items-end " {...register("sex")} defaultValue={data?.sex} >
          <option value="male">Male</option>
          <option value="female">Female</option>
          </select>

          { /* SEX ERROR MESSAGE */ }
          {errors.sex?.message && <p className=" text-xs text-red-400" >{errors.sex.message.toString() }</p>}

        </div>


      </div>

      { /* UPDATE AND CREATE BUTTON */ }
      <button className="bg-blue-400 text-white p-2 rounded-md">
        { type === "create" ? "Create" : "Update" }
      </button>

    </form>

  )
}

export default ParentForm